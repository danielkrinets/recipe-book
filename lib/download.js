const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const ffmpegPath = require('ffmpeg-static');

const run = promisify(execFile);
// Vercel gets the binary from scripts/get-yt-dlp.js; locally fall back to one on PATH
const BUNDLED = path.join(__dirname, '..', 'bin', 'yt-dlp');
const YT_DLP = fs.existsSync(BUNDLED) ? BUNDLED : 'yt-dlp';
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|t\.me)$/i;

function isVideoLink(value) {
  try {
    return VIDEO_HOSTS.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

// Returns the video bytes and the post text (description/caption); throws when the site refuses
async function downloadVideo(url) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dl-'));
  try {
    const { stdout } = await run(YT_DLP, [
      '--no-playlist', '--quiet', '--no-warnings', '--no-simulate', '--dump-json',
      '--match-filter', 'duration < 900',
      // YouTube often has no ready-made video+audio file, so let yt-dlp merge them with our ffmpeg
      '-S', 'res:480', '--ffmpeg-location', ffmpegPath, '--merge-output-format', 'mp4', '--max-filesize', '30M',
      '--cache-dir', path.join(dir, 'cache'),
      '-o', path.join(dir, 'video.%(ext)s'), url,
    ], { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
    const info = JSON.parse(stdout.trim().split('\n').pop());
    const name = (await fs.promises.readdir(dir)).find((n) => n.startsWith('video.'));
    if (!name) throw new Error('nothing downloaded');
    return {
      bytes: await fs.promises.readFile(path.join(dir, name)),
      caption: [info.title, info.description].filter(Boolean).join('\n\n'),
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

module.exports = { isVideoLink, downloadVideo };
