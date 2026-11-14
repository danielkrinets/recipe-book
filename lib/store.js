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
    await db()`CREATE TABLE IF NOT EXISTS album_parts (
      group_id text NOT NULL, message_id bigint NOT NULL, user_id bigint NOT NULL, file_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (group_id, message_id))`;
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

async function listRecipes(userId) {
  await ensureTables();
  return db()`SELECT id, draft, photo_url FROM recipes WHERE user_id = ${userId} ORDER BY saved_at DESC`;
}

async function savePhoto(userId, bytes, mediaType) {
  const { url } = await put(`photos/${userId}/${crypto.randomUUID()}`, bytes, {
    access: 'public', // the random name is the only protection; bucket must be a public store
    contentType: mediaType,
  });
  return url;
}

// Telegram sends the photos of an album as separate updates; they are collected here until the last one arrives
async function addAlbumPart(groupId, userId, messageId, fileId) {
  await ensureTables();
  await db()`INSERT INTO album_parts (group_id, message_id, user_id, file_id)
    VALUES (${groupId}, ${messageId}, ${userId}, ${fileId}) ON CONFLICT DO NOTHING`;
}

// Milliseconds since the newest photo of the album arrived (null when the album is already taken)
async function albumQuietMs(groupId) {
  await ensureTables();
  const rows = await db()`SELECT extract(epoch FROM now() - max(created_at)) * 1000 AS ms FROM album_parts WHERE group_id = ${groupId}`;
  return rows[0].ms === null ? null : Number(rows[0].ms);
}

// Takes the whole album in one statement, so only one of the waiting updates gets it
async function claimAlbum(groupId) {
  await ensureTables();
  const rows = await db()`DELETE FROM album_parts WHERE group_id = ${groupId} OR created_at < now() - interval '1 day'
    RETURNING group_id, message_id, file_id`;
  return rows.filter((r) => r.group_id === groupId).map((r) => ({ messageId: Number(r.message_id), fileId: r.file_id }))
    .sort((x, y) => x.messageId - y.messageId);
}

module.exports = { addAlbumPart, albumQuietMs, claimAlbum, saveDraft, saveRecipe, listRecipes, savePhoto };
