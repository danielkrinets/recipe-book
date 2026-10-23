const crypto = require('node:crypto');

// Telegram Mini App initData: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const MAX_AGE_SEC = 24 * 60 * 60;

function verifyInitData(initData, botToken, nowSec = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams(initData || '');
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const dataCheckString = [...params.keys()]
    .sort()
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowSec - authDate > MAX_AGE_SEC) return null;

  const user = JSON.parse(params.get('user') || 'null');
  return user && user.id ? user : null;
}

module.exports = { verifyInitData };
