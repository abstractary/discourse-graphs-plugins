import { inflateRawSync } from 'node:zlib';
import { extname } from 'node:path';
import { ApiError } from '../http.ts';

const MEDIA_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/msword', '.doc'],
  ['text/markdown', '.md'],
  ['text/plain', '.txt'],
]);

const SUPPORTED = ['.pdf', '.docx', '.md', '.txt'];

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const MAX_XML_BYTES = 64 * 1024 * 1024;

const ENTITIES = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"]]);

export type UploadedDocument = {
  filename: string;
  mediaType?: string;
  data?: Buffer;
  text?: string;
};

function unreadable(what: string): ApiError {
  return new ApiError(422, 'unreadable-file', `Could not read this ${what}. Check that it opens, is not password protected, and try again.`);
}

export function documentType(filename: string, mediaType?: string): string {
  const extension = extname(filename).toLowerCase();
  const type = SUPPORTED.includes(extension) || extension === '.doc' ? extension : MEDIA_TYPES.get(mediaType ?? '');
  if (type === '.doc') {
    throw new ApiError(415, 'unsupported-type', 'Legacy .doc files are not supported. Save it as .docx and try again.');
  }
  if (!type) {
    throw new ApiError(415, 'unsupported-type', `Use a ${SUPPORTED.join(', ')} file.`);
  }
  return type;
}

// Reads just enough of the zip central directory to find one file.
function readZipEntry(zip: Buffer, name: string): Buffer | undefined {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== END_OF_DIRECTORY) end -= 1;
  if (end < 0) throw new Error('No zip directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== DIRECTORY_ENTRY) throw new Error('Bad zip directory');
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const skip = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const local = zip.readUInt32LE(at + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
    }
    at += 46 + nameLength + skip;
  }
  return undefined;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (!entity.startsWith('#')) return ENTITIES.get(entity) ?? whole;
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

function wordXmlToText(xml: string): string {
  let text = '';
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\/>|<w:br\/>/g)) {
    if (match[1] !== undefined) text += decodeEntities(match[1]);
    else text += match[0] === '<w:tab/>' ? '\t' : '\n';
  }
  return text;
}

export function readDocx(data: Buffer): string {
  let xml: Buffer | undefined;
  try {
    xml = readZipEntry(data, 'word/document.xml');
  } catch {
    throw unreadable('.docx file');
  }
  if (!xml) throw unreadable('.docx file');
  return wordXmlToText(xml.toString('utf8'));
}

async function readPdf(data: Buffer): Promise<string> {
  const { getDocument, VerbosityLevel } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(data),
    verbosity: VerbosityLevel.ERRORS,
    disableFontFace: true,
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
      page.cleanup();
    }
    return pages.join('\n\n');
  } catch {
    throw unreadable('PDF');
  } finally {
    await task.destroy();
  }
}

export async function readDocumentText(document: UploadedDocument): Promise<string> {
  let text = document.text;
  if (!text) {
    if (!document.data) {
      throw new ApiError(400, 'no-document', 'Send the file as "dataBase64", or its text as "text".');
    }
    const type = documentType(document.filename, document.mediaType);
    if (type === '.pdf') text = await readPdf(document.data);
    else if (type === '.docx') text = readDocx(document.data);
    else text = document.data.toString('utf8').replace(/^\uFEFF/, '');
  }
  if (!text.trim()) {
    throw new ApiError(422, 'no-text', 'This file has no readable text. A scanned PDF needs OCR first.');
  }
  return text;
}
