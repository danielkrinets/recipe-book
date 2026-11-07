// Blocks links that point at the server's own network; a plain hostname check, not a full SSRF defence
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i;

function validUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return ['http:', 'https:'].includes(url.protocol) && !PRIVATE_HOST.test(url.hostname);
}

module.exports = { validUrl };
