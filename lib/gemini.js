// Gemini can open YouTube links itself (Google fetches the video), which our servers cannot
const { recipePrompt, parseDraft } = require('./extract');

// The main model is often overloaded (503); the lighter one usually still answers
const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const MODEL = MODELS[0];
const apiUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const TIMEOUT_MS = 120_000;
const BUSY = new Set([429, 500, 503]);

function replyText(data) {
  return (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('');
}

async function youtubeDraft(url, categories, apiKey, fetchImpl = fetch) {
  let lastError;
  for (const model of MODELS) {
    try {
      return await askModel(model, url, categories, apiKey, fetchImpl);
    } catch (err) {
      lastError = err;
      if (!BUSY.has(err.status)) throw err;
    }
  }
  throw lastError;
}

async function askModel(model, url, categories, apiKey, fetchImpl) {
  const res = await fetchImpl(apiUrl(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { file_data: { file_uri: url } },
          { text: `${recipePrompt(categories)}\nThe material is the cooking video above: use what is shown, said and written in it.` },
        ],
      }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`gemini ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
  const text = replyText(await res.json());
  if (!text) throw new Error('gemini reply has no text');
  return parseDraft(text);
}

module.exports = { youtubeDraft, replyText, MODEL };
