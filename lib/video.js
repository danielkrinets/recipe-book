const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const ffmpegPath = require('ffmpeg-static');
const { transcribe } = require('./speech');

const MAX_FRAMES = 6; // fewer, smaller frames and light audio keep the Claude and Groq bill low
const run = promisify(execFile);

// Spreads `count` picks evenly over the list, always keeping the first and last item
function pickEvenly(list, count) {
  if (list.length <= count) return list;
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]);
}

// Returns JPEG frames (in order) and the audio track as small mono MP3, or null when there is no sound
async function splitVideo(bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-'));
  try {
    const input = path.join(dir, 'in');
    await fs.writeFile(input, bytes);
    await run(ffmpegPath, ['-v', 'error', '-i', input, '-vf',
      'fps=1/2,scale=w=512:h=512:force_original_aspect_ratio=decrease', '-q:v', '7', path.join(dir, 'f%04d.jpg')]);
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.jpg')).sort();
    const frames = await Promise.all(pickEvenly(names, MAX_FRAMES).map((n) => fs.readFile(path.join(dir, n))));

    let audio = null;
    try {
      const out = path.join(dir, 'audio.mp3');
      await run(ffmpegPath, ['-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '16k', out]);
      audio = await fs.readFile(out);
    } catch (err) {
      console.error('no audio', err.message); // silent clips have no audio stream
    }
    return { frames, audio };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Frames plus the spoken words; speech is optional so a failed transcription still yields a draft
async function readVideo(bytes, speechKey) {
  const { frames, audio } = await splitVideo(bytes);
  let transcript = '';
  if (audio && speechKey) {
    try {
      transcript = await transcribe(audio, speechKey);
    } catch (err) {
      console.error('transcribe failed', err.message);
    }
  }
  return { frames, transcript };
}

module.exports = { pickEvenly, splitVideo, readVideo };
