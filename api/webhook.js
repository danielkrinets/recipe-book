const crypto = require('node:crypto');
const { extractDraft } = require('../lib/extract');
const telegram = require('../lib/telegram');
const store = require('../lib/store');
const { validUrl } = require('../lib/url');
const { readVideo } = require('../lib/video');
const { waitUntil } = require('@vercel/functions');

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
const VIDEO_TOO_LARGE = 'Видео больше 20 МБ, бот такое скачать не может. Пришлите видео покороче.';
// Telegram lets bots download files up to 20 MB
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function mediaTypeOf(filePath) {
  return MEDIA_TYPES[filePath.slice(filePath.lastIndexOf('.')).toLowerCase()] || 'image/jpeg';
}

function videoOf(message) {
  const doc = message.document;
  return message.video || message.video_note || message.animation
    || (doc && /^video\//.test(doc.mime_type || '') ? doc : null);
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
async function makeDraft(message, { extract, video: readFrames, tg, token }) {
  const text = (message.text || '').trim();
  const video = videoOf(message);
  if (video) {
    const file = await tg.getFile(token, video.file_id);
    const { frames, transcript } = await readFrames(await tg.downloadFile(token, file.file_path));
    if (!frames.length) throw new Error('no frames');
    const caption = (message.caption || '').trim();
    const draft = await extract({
      images: frames.map((f) => ({ base64: f.toString('base64'), mediaType: 'image/jpeg' })),
      text: [caption && `Caption: ${caption}`, transcript && `Speech transcript: ${transcript}`]
        .filter(Boolean).join('\n\n') || 'The video has no caption and no speech.',
    });
    // shortcut: a frame near the end usually shows the finished dish; let the user pick one if it is often wrong
    return { draft, photo: { bytes: frames[Math.floor(frames.length * 0.8)], mediaType: 'image/jpeg' } };
  }
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
  const video = videoOf(message);
  if (!message.photo && !video && !text) return;
  if (video && (video.file_size || 0) > MAX_VIDEO_BYTES) return say(VIDEO_TOO_LARGE);

  await say(video ? 'Смотрю видео, это займёт до минуты…' : 'Читаю рецепт…');
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

// Telegram retries any update that does not get 200, so every path ends with 200.
// Work runs after the reply (defer), so a slow video never makes Telegram resend the update.
function createHandler({
  extract = (input) => extractDraft(input, process.env.ANTHROPIC_API_KEY),
  video = (bytes) => readVideo(bytes, process.env.GROQ_API_KEY),
  tg = telegram,
  store: storage = store,
  defer = waitUntil,
} = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'bad secret' });
    }

    const body = req.body || {};
    const deps = { extract, video, tg, store: storage, token: process.env.TELEGRAM_BOT_TOKEN };
    const work = (async () => {
      if (body.callback_query) await handleCallback(body.callback_query, deps);
      else if (body.message && body.message.chat) await handleMessage(body.message, deps);
    })().catch((err) => console.error('webhook failed', err.message));
    defer(work);
    return res.status(200).json({ ok: true });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
