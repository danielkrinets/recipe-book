// Gemini can open YouTube links itself (Google fetches the video), which our servers cannot
const { recipePrompt, parseDraft } = require('./extract');

const MODEL = 'gemini-3.8-flash';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const TIMEOUT_MS = 240_000;

function replyText(data) {
  return (data.steps || [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

async function youtubeDraft(url, categories, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      input: [
        { type: 'video', uri: url },
        { type: 'text', text: `${recipePrompt(categories)}\nThe material is the cooking video above: use what is shown, said and written in it.` },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = replyText(await res.json());
  if (!text) throw new Error('gemini reply has no text');
  return parseDraft(text);
}

module.exports = { youtubeDraft, replyText, MODEL };
