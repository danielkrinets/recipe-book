const { verifyInitData } = require('../lib/initdata');
const { extractDraft } = require('../lib/extract');
const { validUrl } = require('../lib/url');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const user = verifyInitData(req.headers['x-telegram-init-data'], process.env.TELEGRAM_BOT_TOKEN);
  if (!user) return res.status(401).json({ error: 'bad initData' });

  const { url, imageBase64, mediaType } = req.body || {};
  let input;
  if (url && validUrl(url)) input = { url };
  else if (imageBase64 && IMAGE_TYPES.includes(mediaType)) input = { imageBase64, mediaType };
  else return res.status(400).json({ error: 'send a valid link or a jpeg/png/webp/gif image' });

  try {
    const draft = await extractDraft(input, process.env.ANTHROPIC_API_KEY);
    return res.status(200).json({ draft });
  } catch (err) {
    console.error('extract failed', err.message);
    return res.status(502).json({ error: 'could not extract a recipe' });
  }
};
