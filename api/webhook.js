const crypto = require('node:crypto');
const { extractDraft } = require('../lib/extract');
const telegram = require('../lib/telegram');
const store = require('../lib/store');
const { validUrl } = require('../lib/url');

const GREETINGS = {
  ru: 'Привет! Пришлите ссылку на рецепт, текст рецепта или фото. Я подготовлю черновик, а сохранить его решите вы.',
  en: 'Hi! Send a recipe link, the recipe text or a photo. I will prepare a draft, and you decide whether to save it.',
  he: 'שלום! שלחו קישור למתכון, טקסט של מתכון או תמונה. אכין טיוטה, ואתם תחליטו אם לשמור אותה.',
  ar: 'مرحبًا! أرسلوا رابطًا لوصفة أو نص الوصفة أو صورة. سأحضّر مسودة، وتقررون إن كنتم تريدون حفظها.',
};
const FAILED = 'Не удалось разобрать рецепт, попробуйте другой текст или фото';
const STORE_FAILED = 'Не удалось сохранить черновик, попробуйте ещё раз';
const MAX_TEXT = 8000;
// base64 adds a third to the size and the API caps images at 5 MB
const MAX_PHOTO_BYTES = 3.5 * 1024 * 1024;
const MEDIA_TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function mediaTypeOf(filePath) {
  return MEDIA_TYPES[filePath.slice(filePath.lastIndexOf('.')).toLowerCase()] || 'image/jpeg';
}

function sameSecret(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function formatDraft(draft) {
  const text = [
    draft.title,
    '',
    'Ингредиенты:',
    ...draft.ingredients.map((item) => `• ${item}`),
    '',
    'Шаги:',
    ...draft.steps.map((step, i) => `${i + 1}. ${step}`),
  ].join('\n');
  return text.slice(0, 4000); // Telegram caps one message at 4096 characters
}

// Returns the extracted draft and, for a photo, the bytes to keep as the recipe photo
async function makeDraft(message, { extract, tg, token }) {
  const text = (message.text || '').trim();
  if (message.photo) {
    const photo = [...message.photo].reverse().find((p) => (p.file_size || 0) <= MAX_PHOTO_BYTES);
    if (!photo) throw new Error('photo too large');
    const file = await tg.getFile(token, photo.file_id);
    const bytes = await tg.downloadFile(token, file.file_path);
    const mediaType = mediaTypeOf(file.file_path);
    const draft = await extract({ imageBase64: bytes.toString('base64'), mediaType });
    return { draft, photo: { bytes, mediaType } };
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    if (!validUrl(text)) throw new Error('blocked url');
    return { draft: await extract({ url: text }), photo: null };
  }
  if (text.length > MAX_TEXT) throw new Error('text too long');
  return { draft: await extract({ text }), photo: null };
}

async function handleMessage(message, deps) {
  const { tg, token } = deps;
  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const say = (body, replyMarkup) => tg.sendMessage(token, chatId, body, replyMarkup);

  if (/^\/start(\s|$)/.test(text)) {
    const lang = ((message.from && message.from.language_code) || '').slice(0, 2);
    return say(GREETINGS[lang] || GREETINGS.en);
  }
  if (!message.photo && !text) return;

  await say('Читаю рецепт…');
  let made;
  try {
    made = await makeDraft(message, deps);
    if (!made.draft.title) throw new Error('no recipe found');
  } catch (err) {
    console.error('extract failed', err.message);
    return say(FAILED);
  }

  try {
    const { draft, photo } = made;
    const photoUrl = photo ? await deps.store.savePhoto(message.from.id, photo.bytes, photo.mediaType) : null;
    const id = await deps.store.saveDraft(message.from.id, draft, photoUrl);
    return say(formatDraft(draft), { inline_keyboard: [[{ text: 'Сохранить', callback_data: `save:${id}` }]] });
  } catch (err) {
    console.error('store failed', err.message);
    return say(STORE_FAILED);
  }
}

async function handleCallback(query, deps) {
  const { tg, token } = deps;
  const [action, draftId] = (query.data || '').split(':');
  if (action !== 'save') return;
  const saved = await deps.store.saveRecipe(query.from.id, draftId);
  return tg.answerCallbackQuery(token, query.id, saved ? 'Сохранено' : 'Не найдено или уже сохранено');
}

// Telegram retries any update that does not get 200, so every path ends with 200
function createHandler({
  extract = (input) => extractDraft(input, process.env.ANTHROPIC_API_KEY),
  tg = telegram,
  store: storage = store,
} = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'bad secret' });
    }

    const body = req.body || {};
    const deps = { extract, tg, store: storage, token: process.env.TELEGRAM_BOT_TOKEN };
    try {
      if (body.callback_query) await handleCallback(body.callback_query, deps);
      else if (body.message && body.message.chat) await handleMessage(body.message, deps);
    } catch (err) {
      console.error('webhook failed', err.message);
    }
    return res.status(200).json({ ok: true });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
