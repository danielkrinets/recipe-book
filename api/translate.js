const { verifyInitData } = require('../lib/initdata');
const { cors } = require('../lib/cors');
const { cleanRecipe, validLang, translateRecipe } = require('../lib/translate');

// Translates one recipe for the Mini App; only signed-in Telegram users may spend the Claude key
function createHandler({ translate = (recipe, lang) => translateRecipe(recipe, lang, process.env.ANTHROPIC_API_KEY) } = {}) {
  return async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const user = verifyInitData(req.headers['x-telegram-init-data'], process.env.TELEGRAM_BOT_TOKEN);
    if (!user) return res.status(401).json({ error: 'bad initData' });

    const { recipe: raw, lang } = req.body || {};
    const recipe = cleanRecipe(raw);
    if (!recipe || !validLang(lang)) return res.status(400).json({ error: 'send a recipe and a language name' });

    try {
      return res.status(200).json({ recipe: await translate(recipe, lang) });
    } catch (err) {
      console.error('translate failed', err.message);
      return res.status(502).json({ error: 'could not translate' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
