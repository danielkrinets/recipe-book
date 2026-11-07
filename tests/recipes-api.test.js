// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHandler } = require('../api/recipes');

const BOT_TOKEN = '123456:TEST_TOKEN';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

function signedInitData(userId) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId }) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

async function call({ method = 'GET', initData = '', store }) {
  const res = {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { return this; },
  };
  await createHandler({ store })({ method, headers: { 'x-telegram-init-data': initData } }, res);
  return res;
}

const ROW = { id: 'r1', draft: { title: 'Борщ', ingredients: ['свёкла'], steps: ['варить'] }, photo_url: null };

test('preflight is answered with CORS for the GitHub Pages origin', async () => {
  const res = await call({ method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://danielkrinets.github.io');
});

test('rejects requests without valid initData', async () => {
  let asked = false;
  const res = await call({ initData: 'auth_date=1&hash=bad', store: { listRecipes: async () => { asked = true; } } });
  assert.equal(res.statusCode, 401);
  assert.equal(asked, false);
});

test('returns only the signed-in user recipes', async () => {
  const asked = [];
  const store = { listRecipes: async (id) => { asked.push(id); return [ROW]; } };
  const res = await call({ initData: signedInitData(42), store });
  assert.deepEqual(asked, [42]);
  assert.deepEqual(res.body, { recipes: [{ id: 'r1', title: 'Борщ', ingredients: ['свёкла'], steps: ['варить'], photo: '' }] });
});
