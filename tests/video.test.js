// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickEvenly } = require('../lib/video');

test('pickEvenly keeps first and last and spreads the rest', () => {
  assert.deepEqual(pickEvenly([1, 2, 3], 8), [1, 2, 3]);
  assert.deepEqual(pickEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4), [0, 3, 6, 9]);
});
