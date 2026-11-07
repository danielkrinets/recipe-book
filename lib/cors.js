// The Mini App is served from GitHub Pages, so its API calls are cross-origin
const ORIGIN = 'https://danielkrinets.github.io';

// Sets CORS headers; returns true when the request was a preflight and is already answered
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'x-telegram-init-data, content-type');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'OPTIONS') return false;
  res.status(204).end();
  return true;
}

module.exports = { cors, ORIGIN };
