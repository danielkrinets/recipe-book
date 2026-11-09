// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHandler } = require('../api/import');

const BOT_TOKEN = '123456:TEST_TOKEN';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

function signedInitData(userId) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId }) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const DRAFT = { title: 'Пицца', category: 'Выпечка', categoryIcon: '', time: 40, timeEstimated: true, servings: 2, ingredients: [{ name: 'мука', amount: '300', unit: 'г' }], steps: ['замесить'] };

async function call({ body, initData = signedInitData(42), deps = {}, method = 'POST' }) {
  const res = {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    end() { return this; },
  };
  const store = { savePhoto: async () => 'https://blob.test/p.jpg' };
  await createHandler({ extract: async () => DRAFT, gemini: null, store, ...deps })({ method, headers: { 'x-telegram-init-data': initData }, body }, res);
  return res;
}

test('rejects requests without valid initData', async () => {
  let asked = false;
  const res = await call({ body: { input: 'x' }, initData: 'auth_date=1&hash=bad', deps: { extract: async () => { asked = true; } } });
  assert.equal(res.statusCode, 401);
  assert.equal(asked, false);
});

test('rejects empty and oversized input', async () => {
  assert.equal((await call({ body: { input: '  ' } })).statusCode, 400);
  assert.equal((await call({ body: { input: 'x'.repeat(8001) } })).statusCode, 400);
  assert.equal((await call({ body: {} })).statusCode, 400);
});

test('pasted text becomes a recipe, and the user categories reach the model', async () => {
  const seen = [];
  const res = await call({ body: { input: 'Пицца: мука 300 г', categories: ['Выпечка', 'Завтраки'] }, deps: { extract: async (input) => { seen.push(input); return DRAFT; } } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen[0].categories, ['Выпечка', 'Завтраки']);
  assert.deepEqual(res.body.recipe, { ...DRAFT, photo: '' });
});

test('a YouTube link uses Gemini and stores the thumbnail as the photo', async () => {
  const res = await call({
    body: { input: 'https://youtu.be/abcdefghijk' },
    deps: { gemini: async () => DRAFT, thumbnail: async () => Buffer.from('jpg') },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recipe.photo, 'https://blob.test/p.jpg');
});

test('YouTube refusal and missing recipes are reported with a reason', async () => {
  const youtube = await call({ body: { input: 'https://youtu.be/abcdefghijk' }, deps: { youtube: async () => { throw new Error('bot check'); } } });
  assert.deepEqual([youtube.statusCode, youtube.body.error], [422, 'youtube']);
  const empty = await call({ body: { input: 'привет' }, deps: { extract: async () => ({ ...DRAFT, title: '' }) } });
  assert.deepEqual([empty.statusCode, empty.body.error], [422, 'no recipe']);
});
