// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyInitData } = require('../lib/initdata');

const BOT_TOKEN = '123456:TEST_TOKEN';
const NOW = 1_800_000_000;

// Builds a signed initData string the same way Telegram does
function sign(fields, botToken = BOT_TOKEN) {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 42, first_name: 'Katya' });

test('accepts correctly signed fresh initData and returns the user', () => {
  const initData = sign({ auth_date: String(NOW - 60), user });
  assert.deepEqual(verifyInitData(initData, BOT_TOKEN, NOW), { id: 42, first_name: 'Katya' });
});

test('rejects data signed with another bot token', () => {
  const initData = sign({ auth_date: String(NOW - 60), user }, '999:OTHER');
  assert.equal(verifyInitData(initData, BOT_TOKEN, NOW), null);
});

test('rejects tampered fields', () => {
  const initData = sign({ auth_date: String(NOW - 60), user })
    .replace('Katya', 'Mallory');
  assert.equal(verifyInitData(initData, BOT_TOKEN, NOW), null);
});

test('rejects initData older than 24 hours', () => {
  const initData = sign({ auth_date: String(NOW - 25 * 60 * 60), user });
  assert.equal(verifyInitData(initData, BOT_TOKEN, NOW), null);
});

test('rejects missing hash and empty input', () => {
  assert.equal(verifyInitData('auth_date=1&user=%7B%7D', BOT_TOKEN, NOW), null);
  assert.equal(verifyInitData('', BOT_TOKEN, NOW), null);
  assert.equal(verifyInitData(undefined, BOT_TOKEN, NOW), null);
});
