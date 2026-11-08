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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// The watch page, with a consent cookie so EU-style consent walls do not replace it
async function fromWatchPage(id, fetchImpl) {
  const res = await fetchImpl(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: { 'user-agent': UA, cookie: 'SOCS=CAI; CONSENT=YES+1' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const html = await res.text();
  const info = pageInfo(html);
  if (!info.title && !info.description) throw new Error(`watch page ${res.status}, ${html.length} chars, "${(html.match(/<title>(.*?)<\/title>/) || [])[1]}"`);
  return info;
}

// The player API answers with the video details even when playback is refused to datacenter IPs
async function fromPlayerApi(id, fetchImpl) {
  const res = await fetchImpl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({
      videoId: id,
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en' } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const details = (await res.json()).videoDetails;
  if (!details) throw new Error(`player api ${res.status}, no videoDetails`);
  return { title: details.title || '', description: details.shortDescription || '' };
}

// Returns { title, description, thumbnail } for a YouTube video, thumbnail may be null
async function youtubeInfo(id, fetchImpl = fetch) {
  let info;
  const errors = [];
  for (const source of [fromWatchPage, fromPlayerApi]) {
    try {
      info = await source(id, fetchImpl);
      if (info.description) break;
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (!info || !info.description) {
    throw new Error(`youtube gave no description: ${errors.join(' | ')}`);
  }
  const thumbnail = await getJpeg(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, fetchImpl).catch(() => null);
  return { ...info, thumbnail };
}

module.exports = { youtubeId, pageInfo, youtubeInfo };
