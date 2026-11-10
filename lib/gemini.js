// Gemini can open YouTube links itself (Google fetches the video), which our servers cannot
const { recipePrompt, parseDraft } = require('./extract');

const MODEL = 'gemini-flash-latest';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 240_000;

function replyText(data) {
  return (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('');
}

async function youtubeDraft(url, categories, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(API_URL, {
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
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = replyText(await res.json());
  if (!text) throw new Error('gemini reply has no text');
  return parseDraft(text);
}

module.exports = { youtubeDraft, replyText, MODEL };
