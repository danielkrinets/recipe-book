// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickModel, buildContent, fetchPageText, parseDraft, extractDraft } = require('../lib/extract');

// Fake fetch that answers the page URL with html and the Anthropic API with a reply
function fakeFetch({ page = '<p>Pancakes</p>', reply = '{"title":"Pancakes","ingredients":["flour"],"steps":["mix"]}' } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    if (url.startsWith('https://api.anthropic.com')) {
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: reply }] }) };
    }
    return { ok: true, text: async () => page };
  };
  impl.calls = calls;
  return impl;
}

test('pickModel: links go to Haiku, screenshots to Sonnet', () => {
  assert.equal(pickModel({ text: 'x' }), 'claude-haiku-5-5');
  assert.equal(pickModel({ imageBase64: 'AAAA', mediaType: 'image/png' }), 'claude-sonnet-5-5');
});

test('buildContent: screenshot becomes an image block followed by the prompt', () => {
  const content = buildContent({ imageBase64: 'AAAA', mediaType: 'image/png' });
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  assert.equal(content[1].type, 'text');
});

test('fetchPageText strips scripts, styles and tags', async () => {
  const fetchImpl = fakeFetch({ page: '<style>p{}</style><script>x()</script><p>Soup  <b>recipe</b></p>' });
  assert.equal(await fetchPageText('https://example.com', fetchImpl), 'Soup recipe');
});

test('parseDraft reads JSON wrapped in prose or fences', () => {
  const reply = 'Here it is:\n```json\n{"title":"Soup","ingredients":["water"],"steps":["boil"]}\n```';
  assert.deepEqual(parseDraft(reply), { title: 'Soup', ingredients: ['water'], steps: ['boil'] });
});

test('parseDraft rejects replies without a valid draft', () => {
  assert.throws(() => parseDraft('no json here'));
  assert.throws(() => parseDraft('{"title":"x","ingredients":"flour","steps":[]}'));
});

test('extractDraft: link is fetched, sent to Haiku, and parsed', async () => {
  const fetchImpl = fakeFetch();
  const draft = await extractDraft({ url: 'https://example.com/pancakes' }, 'key', fetchImpl);
  assert.equal(draft.title, 'Pancakes');
  const api = fetchImpl.calls.find((c) => c.url.startsWith('https://api.anthropic.com'));
  assert.equal(api.body.model, 'claude-haiku-5-5');
  assert.match(api.body.messages[0].content[0].text, /Pancakes/);
});

test('extractDraft: screenshot goes straight to Sonnet', async () => {
  const fetchImpl = fakeFetch();
  await extractDraft({ imageBase64: 'AAAA', mediaType: 'image/jpeg' }, 'key', fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].body.model, 'claude-sonnet-5-5');
});

test('extractDraft: pasted text goes straight to Haiku without fetching a page', async () => {
  const fetchImpl = fakeFetch();
  await extractDraft({ text: 'Pancakes: flour, milk' }, 'key', fetchImpl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].body.model, 'claude-haiku-5-5');
  assert.match(fetchImpl.calls[0].body.messages[0].content[0].text, /flour, milk/);
});
