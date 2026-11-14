const crypto = require('node:crypto');
const { extractDraft } = require('../lib/extract');
const telegram = require('../lib/telegram');
const store = require('../lib/store');
const { readVideo } = require('../lib/video');
const { isVideoLink, downloadVideo } = require('../lib/download');
const { youtubeInfo, youtubeThumbnail } = require('../lib/youtube');
const { youtubeDraft } = require('../lib/gemini');
const { draftFromVideo, draftFromInput, LINK } = require('../lib/draft');
const { waitUntil } = require('@vercel/functions');

// Bot replies in the user's Telegram language; unknown languages get English
const TEXTS = {
  ru: {
    hello: 'Привет, это Kirti! Пришлите ссылку на рецепт, текст рецепта, фото или видео. Я подготовлю черновик, а сохранить его решите вы.',
    failed: 'Не удалось разобрать рецепт, попробуйте другой текст или фото',
    youtube: 'YouTube не отдаёт мне это видео. Скопируйте описание ролика и пришлите текстом или пришлите само видео файлом.',
    storeFailed: 'Не удалось сохранить черновик, попробуйте ещё раз',
    tooLarge: 'Видео больше 20 МБ, бот такое скачать не может. Пришлите видео покороче.',
    watching: 'Смотрю видео, это займёт до минуты…',
    reading: 'Читаю рецепт…',
    reading_pages: 'Читаю рецепт с нескольких фото, сам расставлю их по порядку…',
    ingredients: 'Ингредиенты:',
    min: 'мин',
    steps: 'Шаги:',
    save: 'Сохранить',
    saved: 'Сохранено',
    notFound: 'Не найдено или уже сохранено',
  },
  en: {
    hello: 'Hi, this is Kirti! Send a recipe link, the recipe text, a photo or a video. I will prepare a draft, and you decide whether to save it.',
    failed: 'Could not read the recipe, try another text or photo',
    youtube: 'YouTube does not let me open this video. Copy the video description and send it as text, or send the video file itself.',
    storeFailed: 'Could not save the draft, please try again',
    tooLarge: 'The video is over 20 MB, the bot cannot download it. Send a shorter video.',
    watching: 'Watching the video, this takes up to a minute…',
    reading: 'Reading the recipe…',
    reading_pages: 'Reading the recipe from several photos, I will put them in order myself…',
    ingredients: 'Ingredients:',
    min: 'min',
    steps: 'Steps:',
    save: 'Save',
    saved: 'Saved',
    notFound: 'Not found or already saved',
  },
  he: {
    hello: 'שלום, כאן Kirti! שלחו קישור למתכון, טקסט של מתכון, תמונה או סרטון. אכין טיוטה, ואתם תחליטו אם לשמור אותה.',
    failed: 'לא הצלחתי לקרוא את המתכון, נסו טקסט או תמונה אחרים',
    youtube: 'יוטיוב לא מאפשר לי לפתוח את הסרטון. העתיקו את תיאור הסרטון ושלחו כטקסט, או שלחו את קובץ הסרטון עצמו.',
    storeFailed: 'לא הצלחתי לשמור את הטיוטה, נסו שוב',
    tooLarge: 'הסרטון גדול מ-20 MB, הבוט לא יכול להוריד אותו. שלחו סרטון קצר יותר.',
    watching: 'צופה בסרטון, זה ייקח עד דקה…',
    reading: 'קורא את המתכון…',
    reading_pages: 'קורא מתכון מכמה תמונות, אסדר אותן לבד…',
    ingredients: 'מצרכים:',
    min: 'דק׳',
    steps: 'אופן ההכנה:',
    save: 'שמירה',
    saved: 'נשמר',
    notFound: 'לא נמצא או כבר נשמר',
  },
};
const textsFor = (from) => TEXTS[((from && from.language_code) || '').slice(0, 2)] || TEXTS.en;
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
  const meta = [draft.category, draft.time ? `${draft.timeEstimated ? '≈ ' : ''}${draft.time} ${t.min}` : ''].filter(Boolean).join(' · ');
  const text = [
    draft.title,
    meta,
    '',
    t.ingredients,
    ...draft.ingredients.map((i) => `• ${i.name}${i.amount || i.unit ? ` — ${[i.amount, i.unit].filter(Boolean).join(' ')}` : ''}`),
    '',
    t.steps,
    ...draft.steps.map((step, i) => `${i + 1}. ${step}`),
  ].filter((line, i) => i !== 1 || line).join('\n');
  return text.slice(0, 4000); // Telegram caps one message at 4096 characters
}

const ALBUM_WAIT_MS = 3000;
const ALBUM_QUIET_MS = 2500; // no new photo for this long means the album is complete
const ALBUM_MAX_WAITS = 4;
const MAX_ALBUM = 8;
const bestPhoto = (message) => [...message.photo].reverse().find((p) => (p.file_size || 0) <= MAX_PHOTO_BYTES);

// Every photo of an album arrives as its own update, in any order and sometimes seconds apart (cold starts).
// Each one stores itself and waits until no new photo has come for a while; the first to wake up claims the whole album.
async function albumLeader(message, deps) {
  const photo = bestPhoto(message);
  if (!photo) throw new Error('photo too large');
  const { store } = deps;
  await store.addAlbumPart(message.media_group_id, message.from.id, message.message_id, photo.file_id);
  for (let i = 0; i < ALBUM_MAX_WAITS; i++) {
    await deps.sleep(ALBUM_WAIT_MS);
    const quiet = await store.albumQuietMs(message.media_group_id);
    if (quiet === null || quiet >= ALBUM_QUIET_MS) break;
  }
  const parts = await store.claimAlbum(message.media_group_id);
  return parts.length ? parts.slice(0, MAX_ALBUM) : null;
}

async function draftFromPhotos(parts, deps) {
  const { extract, tg, token } = deps;
  const files = await Promise.all(parts.map(async (part) => {
    const file = await tg.getFile(token, part.fileId);
    return { bytes: await tg.downloadFile(token, file.file_path), mediaType: mediaTypeOf(file.file_path) };
  }));
  const draft = await extract({
    images: files.map((f) => ({ base64: f.bytes.toString('base64'), mediaType: f.mediaType })),
    pages: true,
    text: 'The photos are pages of one recipe.',
  });
  return { draft, photo: { bytes: files[0].bytes, mediaType: files[0].mediaType } };
}

// Returns the extracted draft and, for a photo or video, the bytes to keep as the recipe photo
async function makeDraft(message, deps) {
  const { extract, tg, token } = deps;
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
  return draftFromInput(text, deps);
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

  let parts = null;
  if (message.photo && message.media_group_id) {
    try {
      parts = await albumLeader(message, deps);
    } catch (err) {
      console.error('album failed', err.message);
      return say(t.failed);
    }
    if (!parts) return; // another photo of this album does the work
  }

  await say(parts && parts.length > 1 ? t.reading_pages : video || (LINK.test(text) && isVideoLink(text)) ? t.watching : t.reading);
  let made;
  try {
    made = parts ? await draftFromPhotos(parts, deps) : await makeDraft(message, deps);
    if (!made.draft.title) throw new Error('no recipe found');
  } catch (err) {
    console.error('extract failed', err.message);
    return say(err.youtube ? t.youtube : t.failed);
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
  thumbnail = youtubeThumbnail,
  gemini = (process.env.GEMINI_API_KEY || process.env.katya4) ? (url, categories) => youtubeDraft(url, categories, (process.env.GEMINI_API_KEY || process.env.katya4)) : null,
  tg = telegram,
  store: storage = store,
  defer = waitUntil,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'bad secret' });
    }

    const body = req.body || {};
    const deps = { extract, video, download, youtube, gemini, thumbnail, tg, store: storage, sleep, token: process.env.TELEGRAM_BOT_TOKEN };
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
