const test = require('node:test');
const assert = require('node:assert');
const { youtubeDraft } = require('../lib/gemini');

const reply = (text) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const fail = (status) => ({ ok: false, status, text: async () => 'busy' });
const recipe = JSON.stringify({ title: 'Блины', category: 'Выпечка', ingredients: ['мука'], steps: ['Смешать'] });

test('falls back to the lighter model when the main one is overloaded', async () => {
  const urls = [];
  const draft = await youtubeDraft('https://www.youtube.com/watch?v=x', [], 'k', async (url) => {
    urls.push(url);
    return urls.length === 1 ? fail(503) : reply(recipe);
  });
  assert.equal(draft.title, 'Блины');
  assert.match(urls[1], /flash-lite/);
});

test('does not retry on a permission error', async () => {
  let calls = 0;
  await assert.rejects(
    youtubeDraft('https://www.youtube.com/watch?v=x', [], 'k', async () => { calls++; return fail(403); }),
    /403/,
  );
  assert.equal(calls, 1);
});
