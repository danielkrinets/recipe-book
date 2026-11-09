// TEMPORARY diagnostic: shows what YouTube answers to Vercel for one fixed public video. Delete after use.
const { pageInfo, youtubeInfo } = require('../lib/youtube');
const ID = '_3g-O27MZY8';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

module.exports = async (req, res) => {
  const out = {};
  try {
    const page = await fetch(`https://www.youtube.com/watch?v=${ID}&hl=en`, { headers: { 'user-agent': UA, cookie: 'SOCS=CAI; CONSENT=YES+1' } });
    const html = await page.text();
    const info = pageInfo(html);
    out.page = { status: page.status, chars: html.length, htmlTitle: (html.match(/<title>(.*?)<\/title>/) || [])[1], title: info.title, descLen: info.description.length, desc: info.description.slice(0, 200), hasConsent: /consent\.youtube|CONSENT/.test(html.slice(0, 5000)) };
  } catch (e) { out.page = { error: e.message }; }
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ videoId: ID, context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en' } } }) });
    const d = await r.json();
    out.api = { status: r.status, playability: d.playabilityStatus && d.playabilityStatus.status, reason: d.playabilityStatus && d.playabilityStatus.reason, title: d.videoDetails && d.videoDetails.title, descLen: d.videoDetails && (d.videoDetails.shortDescription || '').length };
  } catch (e) { out.api = { error: e.message }; }
  try {
    const i = await youtubeInfo(ID);
    out.youtubeInfo = { title: i.title, descLen: i.description.length, desc: i.description.slice(0, 200), thumb: !!i.thumbnail };
  } catch (e) { out.youtubeInfo = { error: e.message }; }
  res.status(200).json(out);
};
