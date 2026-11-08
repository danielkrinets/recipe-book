// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { youtubeId, pageInfo } = require('../lib/youtube');

test('youtubeId reads watch, short, shorts, embed and mobile links', () => {
  const id = 'cc578uViBpk';
  for (const link of [
    `https://www.youtube.com/watch?v=${id}&pp=abc`,
    `https://youtu.be/${id}?si=x`,
    `https://youtube.com/shorts/${id}?si=x`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/embed/${id}`,
  ]) assert.equal(youtubeId(link), id, link);
  assert.equal(youtubeId('https://example.com/watch?v=cc578uViBpk'), null);
  assert.equal(youtubeId('https://youtu.be/short'), null);
  assert.equal(youtubeId('not a url'), null);
});

test('pageInfo takes the og:title and the description from the page data', () => {
  const html = '<meta property="og:title" content="Pizza &amp; &quot;more&quot;"><script>{"shortDescription":"line 1\\nмука \\"00\\""}</script>';
  assert.deepEqual(pageInfo(html), { title: 'Pizza & "more"', description: 'line 1\nмука "00"' });
});
