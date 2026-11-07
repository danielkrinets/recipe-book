const { verifyInitData } = require('../lib/initdata');
const store = require('../lib/store');
const { cors } = require('../lib/cors');

// Returns the recipes the user saved through the bot
function createHandler({ store: storage = store } = {}) {
  return async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

    const user = verifyInitData(req.headers['x-telegram-init-data'], process.env.TELEGRAM_BOT_TOKEN);
    if (!user) return res.status(401).json({ error: 'bad initData' });

    try {
      const rows = await storage.listRecipes(user.id);
      return res.status(200).json({
        recipes: rows.map((r) => ({ id: r.id, ...r.draft, photo: r.photo_url || '' })),
      });
    } catch (err) {
      console.error('list failed', err.message);
      return res.status(502).json({ error: 'could not load recipes' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
