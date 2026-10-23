// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/webhook');

const SECRET = 'webhook-secret';
process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;

const DRAFT = { title: 'Блины', ingredients: ['мука'], steps: ['смешать'] };
const DRAFT_ID = '3f2b8c1e-5d4a-4b6e-9f7a-1c2d3e4f5a6b';

// Telegram stand-in that records every call instead of sending it
function fakeTelegram() {
  const calls = [];
  return {
    calls,
    sendMessage: async (token, chatId, text, replyMarkup) => calls.push({ method: 'sendMessage', chatId, text, replyMarkup }),
    answerCallbackQuery: async (token, id, text) => calls.push({ method: 'answerCallbackQuery', id, text }),
    getFile: async (token, fileId) => {
      calls.push({ method: 'getFile', fileId });
      return { file_path: 'photos/file_1.jpg' };
    },
    downloadFile: async (token, filePath) => {
      calls.push({ method: 'downloadFile', filePath });
      return Buffer.from('img');
    },
  };
}

// Database and Blob stand-in; fail makes every write throw
function fakeStore({ saved = true, fail = false } = {}) {
  const calls = [];
  const check = () => { if (fail) throw new Error('storage down'); };
  return {
    calls,
    savePhoto: async (userId, bytes, mediaType) => {
      check();
      calls.push({ method: 'savePhoto', userId, mediaType });
      return 'https://blob.test/photo.jpg';
    },
    saveDraft: async (userId, draft, photoUrl) => {
      check();
      calls.push({ method: 'saveDraft', userId, draft, photoUrl });
      return DRAFT_ID;
    },
    saveRecipe: async (userId, draftId) => {
      calls.push({ method: 'saveRecipe', userId, draftId });
      return saved;
    },
  };
}

// Minimal stand-in for Vercel's req/res
async function call({ method = 'POST', secret = SECRET, body = {}, extract, tg, store = fakeStore() }) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
  };
  const headers = secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret };
  await createHandler({ extract, tg, store })({ method, headers, body }, res);
  return res;
}

const update = (message) => ({
  update_id: 1,
  message: { chat: { id: 7 }, from: { id: 42, language_code: 'ru' }, ...message },
});
const callback = (data) => ({
  update_id: 3,
  callback_query: { id: 'cb1', from: { id: 42 }, data },
});

test('rejects non-POST', async () => {
  const res = await call({ method: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('rejects a missing or wrong secret header without doing anything', async () => {
  const tg = fakeTelegram();
  const missing = await call({ secret: null, body: update({ text: '/start' }), tg });
  const wrong = await call({ secret: 'nope', body: update({ text: '/start' }), tg });
  assert.equal(missing.statusCode, 401);
  assert.equal(wrong.statusCode, 401);
  assert.equal(tg.calls.length, 0);
});

test('/start sends the greeting in the user language', async () => {
  const tg = fakeTelegram();
  const res = await call({ body: update({ text: '/start' }), tg });
  assert.equal(res.statusCode, 200);
  assert.equal(tg.calls.length, 1);
  assert.equal(tg.calls[0].chatId, 7);
  assert.match(tg.calls[0].text, /^Привет/);
});

test('plain text goes to extractDraft as text and the draft is sent back', async () => {
  const tg = fakeTelegram();
  const extracted = [];
  const extract = async (input) => { extracted.push(input); return DRAFT; };
  const res = await call({ body: update({ text: 'Блины: мука, молоко' }), extract, tg });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(extracted, [{ text: 'Блины: мука, молоко' }]);
  assert.match(tg.calls.at(-1).text, /Блины/);
});

test('a link goes to extractDraft as url', async () => {
  const tg = fakeTelegram();
  const extracted = [];
  const extract = async (input) => { extracted.push(input); return DRAFT; };
  await call({ body: update({ text: 'https://example.com/pancakes' }), extract, tg });
  assert.deepEqual(extracted, [{ url: 'https://example.com/pancakes' }]);
});

test('a private-network link is refused before extraction', async () => {
  const tg = fakeTelegram();
  let called = false;
  const extract = async () => { called = true; return DRAFT; };
  const res = await call({ body: update({ text: 'http://127.0.0.1/admin' }), extract, tg });
  assert.equal(res.statusCode, 200);
  assert.equal(called, false);
  assert.match(tg.calls.at(-1).text, /Не удалось разобрать/);
});

test('a photo is downloaded, base64-encoded and sent to extractDraft', async () => {
  const tg = fakeTelegram();
  const extracted = [];
  const extract = async (input) => { extracted.push(input); return DRAFT; };
  const photo = [{ file_id: 'small', file_size: 1000 }, { file_id: 'big', file_size: 500000 }];
  await call({ body: update({ photo }), extract, tg });
  assert.deepEqual(tg.calls.slice(1).map((c) => c.method), ['getFile', 'downloadFile', 'sendMessage']);
  assert.equal(tg.calls[1].fileId, 'big');
  assert.deepEqual(extracted, [{ imageBase64: Buffer.from('img').toString('base64'), mediaType: 'image/jpeg' }]);
});

test('extraction failure still returns 200 and tells the user', async () => {
  const tg = fakeTelegram();
  const extract = async () => { throw new Error('claude 500'); };
  const res = await call({ body: update({ text: 'Блины' }), extract, tg });
  assert.equal(res.statusCode, 200);
  assert.equal(tg.calls.at(-1).text, 'Не удалось разобрать рецепт, попробуйте другой текст или фото');
});

test('an update without a message is acknowledged and ignored', async () => {
  const tg = fakeTelegram();
  const res = await call({ body: { update_id: 2 }, tg });
  assert.equal(res.statusCode, 200);
  assert.equal(tg.calls.length, 0);
});

test('a draft is stored for the user and sent with a Сохранить button', async () => {
  const tg = fakeTelegram();
  const store = fakeStore();
  await call({ body: update({ text: 'Блины: мука' }), extract: async () => DRAFT, tg, store });
  assert.deepEqual(store.calls, [{ method: 'saveDraft', userId: 42, draft: DRAFT, photoUrl: null }]);
  assert.deepEqual(tg.calls.at(-1).replyMarkup, {
    inline_keyboard: [[{ text: 'Сохранить', callback_data: `save:${DRAFT_ID}` }]],
  });
});

test('a photo is stored as the recipe photo and its URL goes with the draft', async () => {
  const tg = fakeTelegram();
  const store = fakeStore();
  const photo = [{ file_id: 'big', file_size: 500000 }];
  await call({ body: update({ photo }), extract: async () => DRAFT, tg, store });
  assert.deepEqual(store.calls.map((c) => c.method), ['savePhoto', 'saveDraft']);
  assert.equal(store.calls[0].mediaType, 'image/jpeg');
  assert.equal(store.calls[1].photoUrl, 'https://blob.test/photo.jpg');
});

test('Сохранить saves the draft for its owner and confirms', async () => {
  const tg = fakeTelegram();
  const store = fakeStore({ saved: true });
  const res = await call({ body: callback(`save:${DRAFT_ID}`), tg, store });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.calls, [{ method: 'saveRecipe', userId: 42, draftId: DRAFT_ID }]);
  assert.deepEqual(tg.calls, [{ method: 'answerCallbackQuery', id: 'cb1', text: 'Сохранено' }]);
});

test('Сохранить on an unknown or already saved draft says so', async () => {
  const tg = fakeTelegram();
  await call({ body: callback(`save:${DRAFT_ID}`), tg, store: fakeStore({ saved: false }) });
  assert.equal(tg.calls.at(-1).text, 'Не найдено или уже сохранено');
});

test('a storage failure tells the user to retry and still returns 200', async () => {
  const tg = fakeTelegram();
  const res = await call({ body: update({ text: 'Блины' }), extract: async () => DRAFT, tg, store: fakeStore({ fail: true }) });
  assert.equal(res.statusCode, 200);
  assert.equal(tg.calls.at(-1).text, 'Не удалось сохранить черновик, попробуйте ещё раз');
});
