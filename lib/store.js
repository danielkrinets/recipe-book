const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const { put } = require('@vercel/blob');

// Client is created on first use so that requiring this module needs no env vars (tests)
let sql;
const db = () => (sql ||= neon(process.env.DATABASE_URL));
const UUID = /^[0-9a-f-]{36}$/;

let ready;
function ensureTables() {
  ready ||= (async () => {
    await db()`CREATE TABLE IF NOT EXISTS drafts (
      id uuid PRIMARY KEY, user_id bigint NOT NULL, draft jsonb NOT NULL,
      photo_url text, created_at timestamptz NOT NULL DEFAULT now())`;
    await db()`CREATE TABLE IF NOT EXISTS recipes (
      id uuid PRIMARY KEY, user_id bigint NOT NULL, draft jsonb NOT NULL,
      photo_url text, saved_at timestamptz NOT NULL DEFAULT now())`;
  })().catch((err) => {
    ready = null; // retry on the next call instead of caching the failure
    throw err;
  });
  return ready;
}

async function saveDraft(userId, draft, photoUrl) {
  await ensureTables();
  const id = crypto.randomUUID();
  await db()`INSERT INTO drafts (id, user_id, draft, photo_url)
    VALUES (${id}, ${userId}, ${JSON.stringify(draft)}::jsonb, ${photoUrl})`;
  return id;
}

// Returns false when the draft is missing, belongs to someone else, or is already saved
async function saveRecipe(userId, draftId) {
  if (!UUID.test(draftId)) return false;
  await ensureTables();
  const rows = await db()`INSERT INTO recipes (id, user_id, draft, photo_url)
    SELECT id, user_id, draft, photo_url FROM drafts WHERE id = ${draftId} AND user_id = ${userId}
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  return rows.length > 0;
}

async function savePhoto(userId, bytes, mediaType) {
  const { url } = await put(`photos/${userId}/${crypto.randomUUID()}`, bytes, {
    access: 'public', // the random name is the only protection; bucket must be a public store
    contentType: mediaType,
  });
  return url;
}

module.exports = { saveDraft, saveRecipe, savePhoto };
