// Vercel build step: fetches the standalone yt-dlp Linux binary (no Python needed) and checks it against a pinned hash
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = '2026.10.26';
const SHA256 = '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795';
const URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/yt-dlp_linux`;
const OUT = path.join(__dirname, '..', 'bin', 'yt-dlp');

(async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`yt-dlp download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== SHA256) throw new Error(`yt-dlp checksum mismatch: ${hash}`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes, { mode: 0o755 });
  console.log(`yt-dlp ${VERSION} ready`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
