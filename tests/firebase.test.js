// Run from the project root: node --test tests/
// Static checks: the module script needs network (gstatic, Telegram WebView), so it is not executed here
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const config = moduleScript.match(/const firebaseConfig = (\{[\s\S]*?\});/)[1];
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

test('module script loads app and analytics from the pinned SDK version', () => {
  assert.match(moduleScript, new RegExp(`from '${SDK.replace(/\./g, '\\.')}firebase-app\\.js'`));
  assert.match(moduleScript, new RegExp(`from '${SDK.replace(/\./g, '\\.')}firebase-analytics\\.js'`));
});

test('firebaseConfig has every web config field filled in', () => {
  for (const key of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId']) {
    assert.match(config, new RegExp(`${key}: '[^']+'`), `missing or empty ${key}`);
  }
  assert.match(config, /projectId: 'katya-recipes'/);
});

test('initializeApp gets the config and getAnalytics gets the app', () => {
  assert.match(moduleScript, /const firebaseApp = initializeApp\(firebaseConfig\);/);
  assert.match(moduleScript, /getAnalytics\(firebaseApp\);/);
});

test('Firebase code stays out of the plain app script the other tests run', () => {
  const plain = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(plain, /firebase/i);
});
