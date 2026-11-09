const { verifyInitData } = require('../lib/initdata');
const { cors } = require('../lib/cors');
const store = require('../lib/store');
const { extractDraft } = require('../lib/extract');
const { readVideo } = require('../lib/video');
const { downloadVideo } = require('../lib/download');
const { youtubeInfo, youtubeThumbnail } = require('../lib/youtube');
const { youtubeDraft } = require('../lib/gemini');
const { draftFromInput, MAX_TEXT } = require('../lib/draft');

// Imports a recipe from a link or pasted text straight from the Mini App, so nobody has to find the bot chat
function createHandler({
  extract = (input) => extractDraft(input, process.env.ANTHROPIC_API_KEY),
  video = (bytes) => readVideo(bytes, process.env.GROQ_API_KEY),
  download = downloadVideo,
  youtube = youtubeInfo,
  gemini = process.env.GEMINI_API_KEY ? (url, categories) => youtubeDraft(url, categories, process.env.GEMINI_API_KEY) : null,
  thumbnail = youtubeThumbnail,
  store: storage = store,
} = {}) {
  return async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const user = verifyInitData(req.headers['x-telegram-init-data'], process.env.TELEGRAM_BOT_TOKEN);
    if (!user) return res.status(401).json({ error: 'bad initData' });

    const { input, categories } = req.body || {};
    if (typeof input !== 'string' || !input.trim() || input.length > MAX_TEXT) {
      return res.status(400).json({ error: 'send a link or the recipe text' });
    }

    let made;
    try {
      made = await draftFromInput(input, { extract, video, download, youtube, gemini, thumbnail, categories });
    } catch (err) {
      console.error('import failed', err.message);
      return res.status(422).json({ error: err.youtube ? 'youtube' : 'failed' });
    }
    if (!made.draft.title) return res.status(422).json({ error: 'no recipe' });

    // A failed photo upload should not cost the user the whole recipe
    const photo = made.photo
      ? await storage.savePhoto(user.id, made.photo.bytes, made.photo.mediaType).catch((err) => {
        console.error('photo upload failed', err.message);
        return '';
      })
      : '';
    return res.status(200).json({ recipe: { ...made.draft, photo } });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
