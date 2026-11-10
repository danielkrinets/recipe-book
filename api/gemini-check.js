// TEMPORARY: checks that Gemini can read a YouTube video from Vercel; delete after the check
const { youtubeDraft } = require('../lib/gemini');

module.exports = async (req, res) => {
  const key = process.env.GEMINI_API_KEY || process.env.katya4;
  if (!key) return res.status(500).json({ error: 'no key' });
  const id = /^[\w-]{11}$/.test(req.query.v || '') ? req.query.v : 'PUP7U5vTMM0';
  try {
    const d = await youtubeDraft(`https://www.youtube.com/watch?v=${id}`, [], key);
    res.json({ ok: true, title: d.title, category: d.category, time: d.time, ingredients: d.ingredients.length, steps: d.steps.length });
  } catch (err) {
    res.status(502).json({ error: err.message.slice(0, 500) });
  }
};
