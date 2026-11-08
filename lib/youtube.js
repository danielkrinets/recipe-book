// YouTube blocks video downloads from cloud IPs ("confirm you're not a bot"),
// but the watch page still carries the title and description, where most recipes live.
const TIMEOUT_MS = 10_000;
const ID = /^[\w-]{11}$/;

function youtubeId(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com') {
    id = url.searchParams.get('v') || (url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/) || [])[1];
  }
  return id && ID.test(id) ? id : null;
}

function pageInfo(html) {
  const field = (name) => {
    const m = html.match(new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) return '';
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return '';
    }
  };
  const og = html.match(/<meta property="og:title" content="([^"]*)"/);
  const title = og ? og[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
  return { title, description: field('shortDescription') };
}

async function getJpeg(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`thumbnail ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Returns { title, description, thumbnail } for a YouTube video, thumbnail may be null
async function youtubeInfo(id, fetchImpl = fetch) {
  const res = await fetchImpl(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`youtube page ${res.status}`);
  const info = pageInfo(await res.text());
  if (!info.title && !info.description) throw new Error('youtube page has no title or description');
  const thumbnail = await getJpeg(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, fetchImpl).catch(() => null);
  return { ...info, thumbnail };
}

module.exports = { youtubeId, pageInfo, youtubeInfo };
