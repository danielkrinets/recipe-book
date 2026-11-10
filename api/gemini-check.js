// TEMPORARY: checks that Gemini can read a YouTube video from Vercel; delete after the check
const { youtubeDraft } = require('../lib/gemini');

module.exports = async (req, res) => {
  const key = (process.env.GEMINI_API_KEY || process.env.katya4 || '').trim();
  if (!key) return res.status(500).json({ error: 'no key' });
  // shape only, never the key itself
  const shape = { length: key.length, kind: key.startsWith('AIza') ? 'AIza' : key.startsWith('AQ.') ? 'AQ' : 'other', spaces: /\s/.test(key) };
  if (req.query.mode === 'text') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hi' }] }] }),
    });
    return res.json({ shape, status: r.status, body: (await r.text()).slice(0, 300) });
  }
  const id = /^[\w-]{11}$/.test(req.query.v || '') ? req.query.v : 'PUP7U5vTMM0';
  try {
    const d = await youtubeDraft(`https://www.youtube.com/watch?v=${id}`, [], key);
    res.json({ ok: true, title: d.title, category: d.category, time: d.time, ingredients: d.ingredients.length, steps: d.steps.length });
  } catch (err) {
    res.status(502).json({ shape, error: err.message.slice(0, 500) });
  }
};
