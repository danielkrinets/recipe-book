// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/recipe');

const BOT_TOKEN = '123456:TEST_TOKEN';

// Minimal stand-in for Vercel's req/res
function call({ method = 'POST', initData = '', body = {} } = {}) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  const req = { method, headers: { 'x-telegram-init-data': initData }, body };
  return handler(req, res).then(() => res);
}

function signedInitData() {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

test('rejects non-POST', async () => {
  const res = await call({ method: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('rejects requests without valid initData', async () => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  const res = await call({ initData: 'auth_date=1&hash=bad', body: { url: 'https://example.com' } });
  assert.equal(res.statusCode, 401);
});

test('rejects private-network links and unknown image types', async () => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  const initData = signedInitData();
  const local = await call({ initData, body: { url: 'http://127.0.0.1/admin' } });
  assert.equal(local.statusCode, 400);
  const badType = await call({ initData, body: { imageBase64: 'AAAA', mediaType: 'application/pdf' } });
  assert.equal(badType.statusCode, 400);
});
