const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

// 올린 영상을 720p H.264 mp4 로 줄이고(용량 약 1/8) 썸네일을 뽑는다. 한 번에 하나씩 처리한다.
// ffmpeg 가 없으면 원본을 그대로 쓴다(mp4/webm 이면 재생은 된다).
function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => resolve({ code: -1, err: String(e.message) }));
    p.on('exit', (code) => resolve({ code, err }));
  });
}

function probeDuration(ffprobe, file) {
  try {
    const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8', windowsHide: true });
    const d = parseFloat(r.stdout);
    return Number.isFinite(d) ? d : 0;
  } catch { return 0; }
}

function hasFfmpeg(ffmpeg) {
  try { return spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status === 0; } catch { return false; }
}

function createTranscoder(config, store, log = console.log) {
  const queue = [];
  let busy = false;
  const available = hasFfmpeg(config.ffmpeg);
  if (!available) log('[순수튜브] ffmpeg 를 찾지 못했어요. 영상을 줄이지 않고 원본 그대로 저장합니다.');

  async function work(v, src) {
    const out = store.paths.media(v.id), thumb = store.paths.thumb(v.id);
    if (!available) {
      fs.renameSync(src, out);
      Object.assign(v, { status: 'ready', bytes: fs.statSync(out).size, note: '압축 안 함(ffmpeg 없음)' });
      return;
    }
    // 짧은 변이 720 을 넘으면 줄인다(세로 영상도 처리)
    const scale = "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'";
    const r = await run(config.ffmpeg, ['-y', '-i', src, '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out]);
    if (r.code !== 0 || !fs.existsSync(out)) {
      Object.assign(v, { status: 'failed', note: '영상을 변환하지 못했어요: ' + (r.err.split('\n').filter(Boolean).pop() || '알 수 없는 오류') });
      try { fs.unlinkSync(out); } catch { }
      return;
    }
    const duration = probeDuration(config.ffprobe, out);
    await run(config.ffmpeg, ['-y', '-ss', String(Math.min(3, duration * 0.1)), '-i', out, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', thumb]);
    Object.assign(v, { status: 'ready', duration, bytes: fs.statSync(out).size, originalBytes: v.originalBytes, thumb: fs.existsSync(thumb) });
    try { fs.unlinkSync(src); } catch { }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { id, src } = queue.shift();
      const v = store.video(id);
      if (!v) { try { fs.unlinkSync(src); } catch { } continue; }
      try { await work(v, src); } catch (e) { Object.assign(v, { status: 'failed', note: String(e.message) }); }
      store.save();
    }
    busy = false;
  }

  return {
    available,
    enqueue(id, src) { queue.push({ id, src }); pump(); },
    idle: () => !busy && queue.length === 0
  };
}

module.exports = { createTranscoder, probeDuration, hasFfmpeg };
