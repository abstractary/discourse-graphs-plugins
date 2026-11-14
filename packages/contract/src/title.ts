import { type NodeTypeRecord } from "./record.ts";
/**
 * How a unit's title is written in a base, and read back out of one.
 */
export const formatTitle = ({
  format,
  content,
}: {
  format?: string;
  content: string;
}): string => (format ? format.split("{content}").join(content) : content);

/** Returns the content, or null when the title doesn't follow the format. */
export const parseTitle = ({
  format,
  title,
}: {
  format: string;
  title: string;
}): string | null => {
  const [before = "", after = ""] = format.split("{content}");
  if (title.length <= before.length + after.length) return null;
  if (!title.startsWith(before) || !title.endsWith(after)) return null;
  const content = title.slice(before.length, title.length - after.length);
  return content.trim() ? content : null;
};

/**
 * Writing a title in a type's format is an explicit act, so it counts as typing
 * the node. A candidate tag is weaker and only suggests one.
 */
export const recognizeTitle = ({
  title,
  nodeTypes,
}: {
  title: string;
  nodeTypes: NodeTypeRecord[];
}): { type: NodeTypeRecord; content: string } | null => {
  const matches = nodeTypes.flatMap((type) => {
    const content = type.titleFormat
      ? parseTitle({ format: type.titleFormat, title })
      : null;
    return content === null ? [] : [{ type, content }];
  });
  matches.sort((a, b) => a.content.length - b.content.length);
  return matches[0] ?? null;
};
