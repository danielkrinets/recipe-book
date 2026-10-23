// Run from the project root: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Loads the app script into a fresh sandbox with stubbed DOM and storage
function load(storage = {}) {
  const store = new Map(Object.entries(storage));
  const el = () => ({
    innerHTML: '', value: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, click() {}, focus() {}, scrollIntoView() {}, closest() { return null; },
    querySelectorAll() { return []; }
  });
  const sandbox = {
    window: { Telegram: undefined, scrollTo() {} },
    document: { getElementById: el, querySelectorAll: () => [], createElement: el },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
    Image: function () {},
    console
  };
  // Expose internals: top-level const/let are not visible from outside the script
  const exposed = 'globalThis.__app = { parseRecipe, parseCategory, missingSeeds, loadRecipes, SEED, CATEGORIES, PALETTE, CATS_KEY, KEY, OFFERED_KEY };';
  vm.createContext(sandbox);
  vm.runInContext(script + '\n' + exposed, sandbox);
  return { app: sandbox.__app, store };
}

// Results come from a vm realm, so compare plain JSON copies
const plain = x => JSON.parse(JSON.stringify(x));

const goodForm = {
  name: 'Тест',
  category: 'Супы',
  time: '30',
  servings: '2',
  ingredients: [{ name: 'Соль', amount: '1', unit: 'щепотка' }],
  steps: 'Сварить\n\nПодать',
  photo: null
};
const form = patch => ({ ...goodForm, ...patch });

test('parseRecipe accepts a complete form and normalizes it', () => {
  const { app } = load();
  const res = app.parseRecipe(form({ name: '  Борщ  ', steps: ' a \n\n b ' }));
  assert.equal(res.error, undefined);
  assert.equal(res.recipe.title, 'Борщ');
  assert.equal(res.recipe.time, 30);
  assert.equal(res.recipe.baseServings, 2);
  assert.deepEqual(plain(res.recipe.steps), ['a', 'b']);
});

test('parseRecipe turns a comma decimal amount into a dot', () => {
  const { app } = load();
  const res = app.parseRecipe(form({ ingredients: [{ name: 'Масло', amount: '1,5', unit: 'ст. л.' }] }));
  assert.equal(res.recipe.ingredients[0].amount, '1.5');
});

test('parseRecipe rejects bad input with a message', () => {
  const { app } = load();
  const cases = [
    [form({ name: '   ' }), 'Введите название рецепта.'],
    [form({ name: 'x'.repeat(81) }), 'Название не длиннее 80 символов.'],
    [form({ category: 'Нет такой' }), 'Выберите категорию.'],
    [form({ time: '1.5' }), 'Время укажите целым числом минут.'],
    [form({ time: 'час' }), 'Время укажите целым числом минут.'],
    [form({ servings: '' }), 'Порций должно быть не меньше одной.'],
    [form({ servings: '0' }), 'Порций должно быть не меньше одной.'],
    [form({ ingredients: [{ name: ' ', amount: '1', unit: '' }] }), 'Добавьте хотя бы один ингредиент.'],
    [form({ steps: ' \n ' }), 'Опишите приготовление.']
  ];
  for (const [input, message] of cases) {
    assert.deepEqual(plain(app.parseRecipe(input)), { error: message }, JSON.stringify(input));
  }
});

test('parseRecipe allows an empty time (stored as 0)', () => {
  const { app } = load();
  const res = app.parseRecipe(form({ time: '' }));
  assert.equal(res.recipe.time, 0);
});

test('parseCategory accepts a new name with an icon', () => {
  const { app } = load();
  const res = app.parseCategory({ name: ' Завтраки ', icon: '🥞' }, app.CATEGORIES);
  assert.equal(res.category.name, 'Завтраки');
  assert.equal(res.category.icon, '🥞');
  assert.ok(app.PALETTE.includes(res.category.color));
});

test('parseCategory rejects empty, too long, duplicate and icon-less input', () => {
  const { app } = load();
  const existing = app.CATEGORIES;
  assert.deepEqual(plain(app.parseCategory({ name: '  ', icon: '🥞' }, existing)), { error: 'Введите название категории.' });
  assert.deepEqual(plain(app.parseCategory({ name: 'x'.repeat(31), icon: '🥞' }, existing)), { error: 'Название категории не длиннее 30 символов.' });
  assert.deepEqual(plain(app.parseCategory({ name: 'супы', icon: '🥞' }, existing)), { error: 'Такая категория уже есть.' });
  assert.deepEqual(plain(app.parseCategory({ name: 'Новая', icon: '' }, existing)), { error: 'Выберите эмодзи.' });
});

test('missingSeeds adds every seed to an empty list and marks all as offered', () => {
  const { app } = load();
  const res = app.missingSeeds([], []);
  assert.equal(res.add.length, app.SEED.length);
  assert.deepEqual(res.offered, app.SEED.map(s => s.title));
});

test('missingSeeds does not re-add a seed the user deleted after it was offered', () => {
  const { app } = load();
  const titles = app.SEED.map(s => s.title);
  const list = app.SEED.filter(s => s.title !== titles[0]); // user deleted the first seed
  const res = app.missingSeeds(list, titles);
  assert.equal(res.add.length, 0);
});

test('missingSeeds adds only seeds that are new since the last offer', () => {
  const { app } = load();
  const titles = app.SEED.map(s => s.title);
  const older = titles.slice(0, -1); // the last seed did not exist when offered before
  const res = app.missingSeeds(app.SEED.slice(0, -1), older);
  assert.deepEqual(plain(res.add.map(s => s.title)), [titles[titles.length - 1]]);
});

test('loadRecipes on empty storage gives every seed an id and saves them', () => {
  const { app, store } = load();
  const list = app.loadRecipes();
  assert.equal(list.length, app.SEED.length);
  assert.ok(list.every(r => r.id));
  assert.equal(JSON.parse(store.get(app.KEY)).length, app.SEED.length);
});

test('loadRecipes keeps a legacy list and appends only missing seeds', () => {
  const legacy = [{ id: 'a', title: 'Мой рецепт', category: 'Супы', ingredients: [], steps: ['x'], time: 0, baseServings: 1 }];
  const { app } = load({ 'recipe-book-v1': JSON.stringify(legacy) });
  const list = app.loadRecipes();
  assert.equal(list[0].title, 'Мой рецепт');
  assert.equal(list.length, 1 + app.SEED.length);
});

test('SEED recipes are valid: unique titles, known categories, ingredients and steps', () => {
  const { app } = load();
  const titles = app.SEED.map(s => s.title);
  assert.equal(new Set(titles).size, titles.length, 'duplicate seed title');
  const names = app.CATEGORIES.map(c => c.name);
  for (const s of app.SEED) {
    assert.ok(names.includes(s.category), `unknown category in ${s.title}: ${s.category}`);
    assert.ok(s.ingredients.length > 0, `no ingredients in ${s.title}`);
    assert.ok(s.steps.length > 0, `no steps in ${s.title}`);
    assert.ok(s.baseServings >= 1, `bad servings in ${s.title}`);
  }
});
