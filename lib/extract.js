const TEXT_MODEL = 'claude-haiku-5-5';
const IMAGE_MODEL = 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const PAGE_TIMEOUT_MS = 10_000;

const PROMPT = [
  'Extract the recipe from the material below.',
  'Reply with JSON only: {"title": string, "ingredients": string[], "steps": string[]}.',
  'Keep the language of the source. If there is no recipe, reply {"title": "", "ingredients": [], "steps": []}.',
].join('\n');

// Haiku for text and links, Sonnet for screenshots (better at reading images)
function pickModel(input) {
  return input.imageBase64 ? IMAGE_MODEL : TEXT_MODEL;
}

function buildContent(input) {
  if (input.imageBase64) {
    return [
      { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
      { type: 'text', text: PROMPT },
    ];
  }
  return [{ type: 'text', text: `${PROMPT}\n\n${input.text}` }];
}

// Strips tags and collapses whitespace: the model needs the words, not the markup
async function fetchPageText(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`page ${res.status}`);
  const html = await res.text();
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The model may wrap JSON in prose or fences, so take the outermost braces
function parseDraft(reply) {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON in model reply');
  const data = JSON.parse(reply.slice(start, end + 1));
  const isStrings = (list) => Array.isArray(list) && list.every((item) => typeof item === 'string');
  if (typeof data.title !== 'string' || !isStrings(data.ingredients) || !isStrings(data.steps)) {
    throw new Error('draft has wrong shape');
  }
  return { title: data.title, ingredients: data.ingredients, steps: data.steps };
}

async function callClaude(model, content, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const data = await res.json();
  const block = data.content.find((part) => part.type === 'text');
  if (!block) throw new Error('claude reply has no text');
  return block.text;
}

// input: { url } for a link (page is fetched first), { text } for pasted text, or { imageBase64, mediaType } for a screenshot
async function extractDraft(input, apiKey, fetchImpl = fetch) {
  const source = input.url ? { text: await fetchPageText(input.url, fetchImpl) } : input;
  const reply = await callClaude(pickModel(source), buildContent(source), apiKey, fetchImpl);
  return parseDraft(reply);
}

module.exports = { pickModel, buildContent, fetchPageText, parseDraft, callClaude, extractDraft };
