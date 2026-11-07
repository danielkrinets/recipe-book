// Groq hosts Whisper behind an OpenAI-compatible endpoint; free tier accepts files up to 25 MB
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

async function transcribe(audio, apiKey, fetchImpl = fetch) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model', MODEL);
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`speech ${res.status}`);
  return (await res.json()).text || '';
}

module.exports = { transcribe };
