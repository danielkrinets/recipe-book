// Turns a link, text or video into a recipe draft; shared by the bot and the Mini App import
const { validUrl } = require('./url');
const { isVideoLink } = require('./download');
const { youtubeId, youtubeThumbnail } = require('./youtube');

const MAX_TEXT = 8000;
const LINK = /^https?:\/\/\S+$/i;

const jpeg = (bytes) => (bytes ? { bytes, mediaType: 'image/jpeg' } : null);

async function draftFromVideo(bytes, caption, { extract, video: readFrames, categories }) {
  const { frames, transcript } = await readFrames(bytes);
  if (!frames.length) throw new Error('no frames');
  const draft = await extract({
    images: frames.map((f) => ({ base64: f.toString('base64'), mediaType: 'image/jpeg' })),
    text: [caption && `Caption: ${caption}`, transcript && `Speech transcript: ${transcript}`]
      .filter(Boolean).join('\n\n') || 'The video has no caption and no speech.',
    categories,
  });
  // shortcut: a frame near the end usually shows the finished dish; let the user pick one if it is often wrong
  return { draft, photo: jpeg(frames[Math.floor(frames.length * 0.8)]) };
}

// YouTube refuses cloud servers, so Gemini (Google's own model) watches the video for us.
// Without a Gemini key, or if it fails, the title and description are the next best thing.
async function draftFromYoutube(id, { extract, youtube, gemini, categories, thumbnail: getThumb = youtubeThumbnail }) {
  const thumbnail = () => getThumb(id).catch(() => null);
  if (gemini) {
    try {
      const draft = await gemini(`https://www.youtube.com/watch?v=${id}`, categories);
      return { draft, photo: jpeg(await thumbnail()) };
    } catch (err) {
      console.error('gemini failed', err.message);
    }
  }
  const info = await youtube(id).catch((err) => {
    console.error('youtube blocked', err.message);
    throw Object.assign(new Error('youtube blocked'), { youtube: true });
  });
  const draft = await extract({ text: `Video title: ${info.title}\n\nVideo description: ${info.description || '(none)'}`, categories });
  return { draft, photo: jpeg(info.thumbnail || (await thumbnail())) };
}

// The link is kept on the recipe so the user can open the original video or page later
async function draftFromLink(url, deps) {
  if (!validUrl(url)) throw new Error('blocked url');
  const result = await linkDraft(url, deps);
  return { ...result, draft: { ...result.draft, source: url } };
}

async function linkDraft(url, deps) {
  const ytId = youtubeId(url);
  if (ytId) return draftFromYoutube(ytId, deps);
  if (isVideoLink(url)) {
    try {
      const { bytes, caption } = await deps.download(url);
      return await draftFromVideo(bytes, caption, deps);
    } catch (err) {
      console.error('video link failed, reading the page instead', err.message);
    }
  }
  return { draft: await deps.extract({ url, categories: deps.categories }), photo: null };
}

// Text or a single link, as typed in the chat or in the Mini App
async function draftFromInput(input, deps) {
  const text = input.trim();
  if (LINK.test(text)) return draftFromLink(text, deps);
  if (text.length > MAX_TEXT) throw new Error('text too long');
  return deps.extract({ text, categories: deps.categories }).then((draft) => ({ draft, photo: null }));
}

module.exports = { draftFromVideo, draftFromLink, draftFromInput, LINK, MAX_TEXT };
