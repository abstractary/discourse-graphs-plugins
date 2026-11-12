import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createLab, joinLab, lastLine, readNdjson, readRequest, startFakeServer, startTestServer } from './helpers.ts';
import type { Line, TestServer } from './helpers.ts';

const units = [
  { id: 'g1', type: 'Claim', title: 'Anti-dsDNA antibodies predict lupus nephritis.', anchor: 'Anti-dsDNA positivity at diagnosis was an independent predictor.' },
  { id: 'g2', type: 'Evidence', title: 'Low C3 was seen in 40% of patients.', description: 'Measured at diagnosis.' },
  { id: 'g3', type: 'Claim', title: 'Vitamin D has no known effect here.' },
  { id: 'g4', type: 'Question', title: 'Which markers predict nephritis?', paper: 'Kwon 2018' },
];

async function ask(server: TestServer, token: string | undefined, body: unknown): Promise<Line[]> {
  const response = await server.post('/v1/ai/ask', body, token);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  return readNdjson(response);
}

function sse(events: unknown[]): string {
  return events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
}

const anthropicStream = (texts: string[], stopReason = 'end_turn'): string =>
  sse([
    { type: 'message_start', message: {} },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hidden reasoning' } },
    ...texts.map((text) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } })),
    { type: 'message_delta', delta: { stop_reason: stopReason } },
    { type: 'message_stop' },
  ]);

type Seen = { url?: string; headers?: Record<string, unknown>; body?: any };

async function fakeModel(t: TestContext, stream: string, seen: Seen = {}, status = 200): Promise<string> {
  return startFakeServer(t, async (req, res) => {
    seen.url = req.url;
    seen.headers = req.headers;
    seen.body = JSON.parse((await readRequest(req)).toString('utf8'));
    res.writeHead(status, { 'content-type': 'text/event-stream' });
    res.end(stream);
  });
}

test('asking needs a member token', async (t) => {
  const server = await startTestServer(t);
  const none = await server.post('/v1/ai/ask', { question: 'x', units });
  assert.equal(none.status, 401);
  const wrong = await server.post('/v1/ai/ask', { question: 'x', units }, 'made-up-token');
  assert.equal(wrong.status, 403);
});

test('search-only quotes units verbatim and says no model is connected', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  const lines = await ask(server, member, { question: 'Do anti-dsDNA antibodies predict nephritis?', units });

  const result = lastLine(lines);
  assert.equal(result.type, 'result');
  assert.equal(result.mode, 'search-only');
  assert.ok(!('model' in result));
  const [firstLine] = result.answer.split('\n');
  assert.match(firstLine, /no model is connected/i);

  assert.equal(result.citations[0], 'g1', 'the unit sharing the most terms comes first');
  assert.ok(result.citations.includes('g4'));
  assert.ok(!result.citations.includes('g3'), 'a unit sharing no terms is left out');
  assert.ok(result.answer.includes(units[0].title));
  assert.ok(result.answer.includes(units[0].anchor as string));

  // Every line past the first must be a real unit field, so nothing was invented.
  const fields = units.flatMap((unit) => [unit.title, unit.description, unit.anchor]);
  const body = result.answer.split('\n').slice(1).filter(Boolean);
  assert.ok(body.length > 0);
  for (const line of body) {
    const text = line.replace(/^\[g\d+\] /, '');
    assert.ok(fields.includes(text), `not verbatim: ${line}`);
  }

  const streamed = lines.filter((line) => line.type === 'delta').map((line) => line.text).join('');
  assert.equal(streamed, result.answer);
});

test('search-only keeps to grounded units', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const result = lastLine(await ask(server, lab.adminToken, {
    question: 'Do anti-dsDNA antibodies predict nephritis?',
    units,
    grounded: ['g4'],
  }));
  assert.deepEqual(result.citations, ['g4']);
  assert.ok(!result.answer.includes(units[0].title));
});

test('an empty grounded list narrows nothing', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const result = lastLine(await ask(server, lab.adminToken, { question: 'nephritis markers', units, grounded: [] }));
  assert.ok(result.citations.length > 0);
});

test('search-only says so when nothing matches, and invents nothing', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const result = lastLine(await ask(server, lab.adminToken, { question: 'zebrafish habitat', units }));
  assert.equal(result.type, 'result');
  assert.deepEqual(result.citations, []);
  assert.match(result.answer, /no model is connected/i);
  for (const unit of units) assert.ok(!result.answer.includes(unit.title));
});

test('bad questions come back as error lines', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  for (const body of [
    { units },
    { question: 'x' },
    { question: 'x', units: [{ id: 1 }] },
    { question: 'x', units, grounded: 'g1' },
    { question: 'x', units, grounded: ['nope'] },
    { question: 'x', units: [] },
  ]) {
    const line = lastLine(await ask(server, lab.adminToken, body));
    assert.equal(line.type, 'error', JSON.stringify(body));
    assert.equal(typeof line.message, 'string');
  }
});

test('with ANTHROPIC_API_KEY it streams from the Messages API', async (t) => {
  const seen: Seen = {};
  const anthropicBaseUrl = await fakeModel(t, anthropicStream(['Anti-dsDNA ', 'predicts it [g1], and C3 too [g2, g9]. ', 'See [not-a-unit].']), seen);
  const server = await startTestServer(t, { anthropicKey: 'fake-anthropic-key', anthropicBaseUrl });
  const lab = await createLab(server);
  const lines = await ask(server, lab.adminToken, { question: 'What predicts nephritis?', units });

  assert.equal(seen.url, '/v1/messages');
  assert.equal(seen.headers?.['x-api-key'], 'fake-anthropic-key');
  assert.equal(seen.headers?.['anthropic-version'], '2026-10-21');
  assert.equal(seen.body.model, 'claude-sonnet-5-5');
  assert.equal(seen.body.stream, true);
  assert.match(seen.body.system, /only from those units/);
  assert.match(seen.body.system, /square brackets/);
  assert.match(seen.body.system, /do not answer the question, say so/);
  assert.ok(!('temperature' in seen.body));
  assert.match(seen.body.messages[0].content, /What predicts nephritis\?/);
  assert.ok(seen.body.messages[0].content.includes(units[0].title));

  assert.deepEqual(lines.filter((line) => line.type === 'delta').map((line) => line.text), [
    'Anti-dsDNA ',
    'predicts it [g1], and C3 too [g2, g9]. ',
    'See [not-a-unit].',
  ]);
  const result = lastLine(lines);
  assert.equal(result.mode, 'model');
  assert.equal(result.model, 'claude-sonnet-5-5');
  assert.equal(result.answer, 'Anti-dsDNA predicts it [g1], and C3 too [g2, g9]. See [not-a-unit].');
  assert.deepEqual(result.citations, ['g1', 'g2'], 'only ids of real units count');
});

test('grounded units are the only units the model sees', async (t) => {
  const seen: Seen = {};
  const anthropicBaseUrl = await fakeModel(t, anthropicStream(['Only [g2] here, not [g1].']), seen);
  const server = await startTestServer(t, { anthropicKey: 'k', anthropicBaseUrl, aiModel: 'claude-opus-5-5' });
  const lab = await createLab(server);
  const result = lastLine(await ask(server, lab.adminToken, { question: 'x', units, grounded: ['g2'] }));
  assert.equal(seen.body.model, 'claude-opus-5-5');
  assert.ok(seen.body.messages[0].content.includes(units[1].title));
  assert.ok(!seen.body.messages[0].content.includes(units[0].title));
  assert.deepEqual(result.citations, ['g2']);
});

test('a refusal, a bad key and a stream error all become plain error lines', async (t) => {
  const refused = await fakeModel(t, anthropicStream([], 'refusal'));
  const badKey = await fakeModel(t, '{"error":{"message":"secret upstream detail"}}', {}, 401);
  const midStream = await fakeModel(t, sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]));
  const notFound = await fakeModel(t, 'nope', {}, 404);
  const cases: [string, RegExp][] = [
    [refused, /declined/],
    [badKey, /ANTHROPIC_API_KEY/],
    [midStream, /try again/i],
    [notFound, /AI_MODEL/],
    ['http://127.0.0.1:9', /could not reach/i],
  ];
  for (const [anthropicBaseUrl, expected] of cases) {
    const server = await startTestServer(t, { anthropicKey: 'the-real-key-value', anthropicBaseUrl });
    const lab = await createLab(server);
    const lines = await ask(server, lab.adminToken, { question: 'x', units });
    const line = lastLine(lines);
    assert.deepEqual(Object.keys(line).sort(), ['message', 'type']);
    assert.equal(line.type, 'error');
    assert.match(line.message, expected);
    assert.ok(!JSON.stringify(lines).includes('the-real-key-value'));
    assert.ok(!JSON.stringify(lines).includes('secret upstream detail'));
  }
});

const openRouterStream = sse([
  { choices: [{ delta: { content: 'C3 is low ' } }] },
  { choices: [{ delta: { content: '[g2].' } }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
  '[DONE]',
]);

test('with only OPENROUTER_API_KEY it streams from chat completions', async (t) => {
  const seen: Seen = {};
  const openRouterBaseUrl = await fakeModel(t, `: OPENROUTER PROCESSING\n\n${openRouterStream}`, seen);
  const server = await startTestServer(t, { openRouterKey: 'fake-router-key', openRouterBaseUrl });
  const lab = await createLab(server);
  const info = (await (await server.get('/v1/info')).json()) as any;
  assert.deepEqual(info.ai, { mode: 'model', model: 'anthropic/claude-sonnet-5.5' });

  const lines = await ask(server, lab.adminToken, { question: 'What about C3?', units });
  assert.equal(seen.url, '/chat/completions');
  assert.equal(seen.headers?.authorization, 'Bearer fake-router-key');
  assert.equal(seen.body.stream, true);
  assert.equal(seen.body.model, 'anthropic/claude-sonnet-5.5');
  assert.equal(seen.body.messages[0].role, 'system');
  assert.match(seen.body.messages[0].content, /only from those units/);
  assert.equal(seen.body.messages[1].role, 'user');

  assert.deepEqual(lines.filter((line) => line.type === 'delta').map((line) => line.text), ['C3 is low ', '[g2].']);
  assert.deepEqual(lastLine(lines), {
    type: 'result',
    answer: 'C3 is low [g2].',
    citations: ['g2'],
    mode: 'model',
    model: 'anthropic/claude-sonnet-5.5',
  });
});

test('Anthropic wins when both keys are set', async (t) => {
  const seen: Seen = {};
  const anthropicBaseUrl = await fakeModel(t, anthropicStream(['Hi']), seen);
  const server = await startTestServer(t, {
    anthropicKey: 'k',
    anthropicBaseUrl,
    openRouterKey: 'r',
    openRouterBaseUrl: 'http://127.0.0.1:9',
  });
  const lab = await createLab(server);
  assert.equal(lastLine(await ask(server, lab.adminToken, { question: 'x', units })).type, 'result');
  assert.equal(seen.url, '/v1/messages');
});

test('an OpenRouter error inside a 200 stream becomes an error line', async (t) => {
  const stream = sse([
    { choices: [{ delta: { content: 'Partial' } }] },
    { error: { code: 429, message: 'Rate limit exceeded' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] },
  ]);
  const openRouterBaseUrl = await fakeModel(t, stream);
  const server = await startTestServer(t, { openRouterKey: 'r', openRouterBaseUrl });
  const lab = await createLab(server);
  const lines = await ask(server, lab.adminToken, { question: 'x', units });
  assert.equal(lastLine(lines).type, 'error');
  assert.ok(!lines.some((line) => line.type === 'result'));
});

test("a member's own key is used for that one question, at the provider's own address", async (t) => {
  const seen: Seen = {};
  const anthropicBaseUrl = await fakeModel(t, anthropicStream(['From ', 'your key [g1].']), seen);
  // The server has no key of its own here.
  const server = await startTestServer(t, { anthropicBaseUrl });
  const lab = await createLab(server);
  const lines = await ask(server, lab.adminToken, {
    question: 'What predicts nephritis?',
    units,
    provider: { kind: 'anthropic', model: 'claude-haiku-5-5', key: 'members-own-key', baseUrl: 'http://attacker.example' },
  });
  const result = lastLine(lines);
  assert.equal(result.mode, 'model');
  assert.equal(result.model, 'claude-haiku-5-5');
  assert.deepEqual(result.citations, ['g1']);
  assert.equal(seen.headers?.['x-api-key'], 'members-own-key');
  assert.equal(seen.body.model, 'claude-haiku-5-5');
  assert.ok(!JSON.stringify(lines).includes('members-own-key'), 'the key is never echoed');

  const bad = lastLine(await ask(server, lab.adminToken, { question: 'x', units, provider: { kind: 'other', model: 'm', key: 'k' } }));
  assert.equal(bad.type, 'error');
});

test("a member's own Gemini key streams through the Gemini format", async (t) => {
  const seen: Seen = {};
  const geminiBaseUrl = await fakeModel(t, sse([{ candidates: [{ content: { parts: [{ text: 'Low C3 [g2].' }] } }] }]), seen);
  const server = await startTestServer(t, { geminiBaseUrl });
  const lab = await createLab(server);
  const result = lastLine(await ask(server, lab.adminToken, { question: 'C3?', units, provider: { kind: 'gemini', model: 'gemini-3.8-flash', key: 'g-key' } }));
  assert.deepEqual([result.mode, result.answer], ['model', 'Low C3 [g2].']);
  assert.equal(seen.headers?.['x-goog-api-key'], 'g-key');
  assert.match(String(seen.url), /models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
});
