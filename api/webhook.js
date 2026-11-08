const crypto = require('node:crypto');
const { extractDraft } = require('../lib/extract');
const telegram = require('../lib/telegram');
const store = require('../lib/store');
const { validUrl } = require('../lib/url');
const { readVideo } = require('../lib/video');
const { isVideoLink, downloadVideo } = require('../lib/download');
const { youtubeId, youtubeInfo } = require('../lib/youtube');
const { waitUntil } = require('@vercel/functions');

// Bot replies in the user's Telegram language; unknown languages get English
const TEXTS = {
  ru: {
    hello: 'Привет! Пришлите ссылку на рецепт, текст рецепта, фото или видео. Я подготовлю черновик, а сохранить его решите вы.',
    failed: 'Не удалось разобрать рецепт, попробуйте другой текст или фото',
    storeFailed: 'Не удалось сохранить черновик, попробуйте ещё раз',
    tooLarge: 'Видео больше 20 МБ, бот такое скачать не может. Пришлите видео покороче.',
    watching: 'Смотрю видео, это займёт до минуты…',
    reading: 'Читаю рецепт…',
    ingredients: 'Ингредиенты:',
    steps: 'Шаги:',
    save: 'Сохранить',
    saved: 'Сохранено',
    notFound: 'Не найдено или уже сохранено',
  },
  en: {
    hello: 'Hi! Send a recipe link, the recipe text, a photo or a video. I will prepare a draft, and you decide whether to save it.',
    failed: 'Could not read the recipe, try another text or photo',
    storeFailed: 'Could not save the draft, please try again',
    tooLarge: 'The video is over 20 MB, the bot cannot download it. Send a shorter video.',
    watching: 'Watching the video, this takes up to a minute…',
    reading: 'Reading the recipe…',
    ingredients: 'Ingredients:',
    steps: 'Steps:',
    save: 'Save',
    saved: 'Saved',
    notFound: 'Not found or already saved',
  },
  he: {
    hello: 'שלום! שלחו קישור למתכון, טקסט של מתכון, תמונה או סרטון. אכין טיוטה, ואתם תחליטו אם לשמור אותה.',
    failed: 'לא הצלחתי לקרוא את המתכון, נסו טקסט או תמונה אחרים',
    storeFailed: 'לא הצלחתי לשמור את הטיוטה, נסו שוב',
    tooLarge: 'הסרטון גדול מ-20 MB, הבוט לא יכול להוריד אותו. שלחו סרטון קצר יותר.',
    watching: 'צופה בסרטון, זה ייקח עד דקה…',
    reading: 'קורא את המתכון…',
    ingredients: 'מצרכים:',
    steps: 'אופן ההכנה:',
    save: 'שמירה',
    saved: 'נשמר',
    notFound: 'לא נמצא או כבר נשמר',
  },
};
const textsFor = (from) => TEXTS[((from && from.language_code) || '').slice(0, 2)] || TEXTS.en;
const MAX_TEXT = 8000;
// base64 adds a third to the size and the API caps images at 5 MB
const MAX_PHOTO_BYTES = 3.5 * 1024 * 1024;
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

function formatDraft(draft, t) {
  const text = [
    draft.title,
    '',
    t.ingredients,
    ...draft.ingredients.map((item) => `• ${item}`),
    '',
    t.steps,
    ...draft.steps.map((step, i) => `${i + 1}. ${step}`),
  ].join('\n');
  return text.slice(0, 4000); // Telegram caps one message at 4096 characters
}

async function draftFromVideo(bytes, caption, { extract, video: readFrames }) {
  const { frames, transcript } = await readFrames(bytes);
  if (!frames.length) throw new Error('no frames');
  console.log(`video read: ${bytes.length} bytes, ${frames.length} frames, transcript ${transcript.length} chars, caption ${caption.length} chars`);
  const draft = await extract({
    images: frames.map((f) => ({ base64: f.toString('base64'), mediaType: 'image/jpeg' })),
    text: [caption && `Caption: ${caption}`, transcript && `Speech transcript: ${transcript}`]
      .filter(Boolean).join('\n\n') || 'The video has no caption and no speech.',
  });
  // shortcut: a frame near the end usually shows the finished dish; let the user pick one if it is often wrong
  return { draft, photo: { bytes: frames[Math.floor(frames.length * 0.8)], mediaType: 'image/jpeg' } };
}

// Title and description stand in for the video; the thumbnail helps the model and becomes the photo
async function draftFromYoutube({ title, description, thumbnail }, extract) {
  console.log(`youtube info: title "${title}", description ${description.length} chars: ${description.slice(0, 150).replace(/\n/g, ' ')}`);
  const text = `Video title: ${title}\n\nVideo description: ${description || '(none)'}`;
  const draft = thumbnail
    ? await extract({ images: [{ base64: thumbnail.toString('base64'), mediaType: 'image/jpeg' }], text })
    : await extract({ text });
  return { draft, photo: thumbnail ? { bytes: thumbnail, mediaType: 'image/jpeg' } : null };
}

// Returns the extracted draft and, for a photo or video, the bytes to keep as the recipe photo
async function makeDraft(message, deps) {
  const { extract, download, youtube, tg, token } = deps;
  const text = (message.text || '').trim();
  const video = videoOf(message);
  if (video) {
    const file = await tg.getFile(token, video.file_id);
    return draftFromVideo(await tg.downloadFile(token, file.file_path), (message.caption || '').trim(), deps);
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
    if (isVideoLink(text)) {
      try {
        const { bytes, caption } = await download(text);
        return await draftFromVideo(bytes, caption, deps);
      } catch (err) {
        console.error('video link failed, reading the page instead', err.message);
      }
    }
    const ytId = youtubeId(text);
    if (ytId) return draftFromYoutube(await youtube(ytId), extract);
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
  const t = textsFor(message.from);

  if (/^\/start(\s|$)/.test(text)) return say(t.hello);
  const video = videoOf(message);
  if (!message.photo && !video && !text) return;
  if (video && (video.file_size || 0) > MAX_VIDEO_BYTES) return say(t.tooLarge);

  await say(video || isVideoLink(text) ? t.watching : t.reading);
  let made;
  try {
    made = await makeDraft(message, deps);
    if (!made.draft.title) throw new Error('no recipe found');
  } catch (err) {
    console.error('extract failed', err.message);
    return say(t.failed);
  }

  try {
    const { draft, photo } = made;
    const photoUrl = photo ? await deps.store.savePhoto(message.from.id, photo.bytes, photo.mediaType) : null;
    const id = await deps.store.saveDraft(message.from.id, draft, photoUrl);
    return say(formatDraft(draft, t), { inline_keyboard: [[{ text: t.save, callback_data: `save:${id}` }]] });
  } catch (err) {
    console.error('store failed', err.message);
    return say(t.storeFailed);
  }
}

async function handleCallback(query, deps) {
  const { tg, token } = deps;
  const [action, draftId] = (query.data || '').split(':');
  if (action !== 'save') return;
  const saved = await deps.store.saveRecipe(query.from.id, draftId);
  const t = textsFor(query.from);
  return tg.answerCallbackQuery(token, query.id, saved ? t.saved : t.notFound);
}

// Telegram retries any update that does not get 200, so every path ends with 200.
// Work runs after the reply (defer), so a slow video never makes Telegram resend the update.
function createHandler({
  extract = (input) => extractDraft(input, process.env.ANTHROPIC_API_KEY),
  video = (bytes) => readVideo(bytes, process.env.GROQ_API_KEY),
  download = downloadVideo,
  youtube = youtubeInfo,
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
    const deps = { extract, video, download, youtube, tg, store: storage, token: process.env.TELEGRAM_BOT_TOKEN };
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
