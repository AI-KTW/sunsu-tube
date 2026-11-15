const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

// 올린 영상을 720p(기본)와 360p(느린 망용) H.264 mp4 로 줄이고 썸네일을 뽑는다. 한 번에 하나씩 처리한다.
// 잘라내기(trim)도 같은 줄에서 처리한다. ffmpeg 가 없으면 원본을 그대로 쓴다(mp4/webm 이면 재생은 된다).
function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => resolve({ code: -1, err: String(e.message) }));
    p.on('exit', (code) => resolve({ code, err }));
  });
}

function probe(ffprobe, file) {
  try {
    const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8', windowsHide: true });
    const j = JSON.parse(r.stdout || '{}'), s = (j.streams || []).find((x) => x.codec_type === 'video') || {};
    const d = parseFloat((j.format || {}).duration);
    return { duration: Number.isFinite(d) ? d : 0, width: s.width || 0, height: s.height || 0, audio: (j.streams || []).some((x) => x.codec_type === 'audio') };
  } catch { return { duration: 0, width: 0, height: 0, audio: false }; }
}

function hasFfmpeg(ffmpeg) {
  try { return spawnSync(ffmpeg, ['-version'], { windowsHide: true }).status === 0; } catch { return false; }
}

// 짧은 변이 n 을 넘으면 줄인다(세로 영상도 처리)
const scaleTo = (n) => `scale='if(gt(iw,ih),-2,min(${n},iw))':'if(gt(iw,ih),min(${n},ih),-2)'`;
const codec = (crf, abr) => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', abr, '-movflags', '+faststart'];
const outArgs = (n, crf, abr) => ['-vf', scaleTo(n), ...codec(crf, abr)];

// 소리 정리: 낮은 웅웅거림과 잡음을 줄이고, 소리 크기를 듣기 좋은 수준으로 맞춘다.
const AUDIO_FIX = 'highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11';

// 가릴 네모 목록을 다듬는다: [{x,y,w,h(화면 대비 0~1), s,e(초)}]
function cleanBoxes(list, duration = Infinity) {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d), c = (v) => Math.max(0, Math.min(1, v));
  return (Array.isArray(list) ? list : []).slice(0, 20).map((b) => { const x = c(n(b.x, -1)), y = c(n(b.y, -1)), w = Math.min(1 - x, n(b.w, 0)), h = Math.min(1 - y, n(b.h, 0));
    const s = Math.max(0, n(b.s, 0)), e = Math.min(duration === Infinity ? 1e7 : duration + 1, b.e == null ? 1e7 : n(b.e, 1e7));
    return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4), s: +s.toFixed(2), e: +e.toFixed(2) }; }).filter((b) => b.w >= 0.01 && b.h >= 0.01 && b.e > b.s);
}

// 남길 구간 목록을 다듬는다: [{s,e}] → 시간순, 겹치면 합침, 영상 길이 안으로.
function cleanRanges(list, duration = Infinity) {
  const out = [];
  const rs = (Array.isArray(list) ? list : []).map((r) => [Math.max(0, Number(r.s)), Math.min(duration, Number(r.e))]).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s + 0.3).sort((a, b) => a[0] - b[0]).slice(0, 60);
  for (const r of rs) { const p = out[out.length - 1]; if (p && r[0] <= p[1]) p[1] = Math.max(p[1], r[1]); else out.push([+r[0].toFixed(2), +r[1].toFixed(2)]); }
  return out;
}

function createTranscoder(config, store, log = console.log, onDone = () => { }) {
  const queue = [];
  let busy = false;
  const available = hasFfmpeg(config.ffmpeg);
  if (!available) log('[순수TV] ffmpeg 를 찾지 못했어요. 영상을 줄이지 않고 원본 그대로 저장합니다.');

  async function makeThumb(id, t, fromFile) {
    const out = store.paths.thumb(id);
    const args = fromFile ? ['-y', '-i', fromFile, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out]
      : ['-y', '-ss', String(Math.max(0, t || 0)), '-i', store.paths.media(id), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out];
    const r = await run(config.ffmpeg, args);
    return r.code === 0 && fs.existsSync(out);
  }

  // src 를 720p(+360p)로 만든다. opt.ranges = [[시작, 끝], ...] 면 그 구간들만 이어 붙이고,
  // opt.boxes 면 그 네모 부분을 모자이크로 가리고, opt.clean 이면 소리를 정리한다.
  async function encode(v, src, opt = {}) {
    const out = store.paths.media(v.id), low = store.paths.mediaLow(v.id);
    const info = probe(config.ffprobe, src), wantLow = Math.min(info.width, info.height) > 400;
    const ranges = opt.ranges && opt.ranges.length ? opt.ranges : null, boxes = opt.boxes && opt.boxes.length && info.width ? opt.boxes : null, clean = opt.clean && info.audio;
    let args = ['-y', '-i', src, ...outArgs(720, 26, '96k'), out, ...(wantLow ? [...outArgs(360, 30, '64k'), low] : [])];
    if (ranges || boxes || clean) {
      const f = []; let vl = '0:v', al = info.audio ? '0:a' : null;
      if (ranges) {
        ranges.forEach(([s, e], i) => { f.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`); if (al) f.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`); });
        f.push(ranges.map((_, i) => `[v${i}]${al ? `[a${i}]` : ''}`).join('') + `concat=n=${ranges.length}:v=1:a=${al ? 1 : 0}[vc]${al ? '[ac]' : ''}`);
        vl = 'vc'; if (al) al = 'ac';
      }
      if (boxes) boxes.forEach((b, i) => {   // 네모를 잘라 작게 줄였다 키워(모자이크) 제자리에 덮는다
        const even = (n) => Math.max(2, Math.round(n / 2) * 2), w = Math.min(even(b.w * info.width), even(info.width)), h = Math.min(even(b.h * info.height), even(info.height));
        const x = Math.max(0, Math.min(info.width - w, Math.round(b.x * info.width))), y = Math.max(0, Math.min(info.height - h, Math.round(b.y * info.height)));
        f.push(`[${vl}]split[bb${i}][bm${i}]`, `[bm${i}]crop=${w}:${h}:${x}:${y},scale=${Math.max(2, Math.round(w / 24))}:${Math.max(2, Math.round(h / 24))},scale=${w}:${h}:flags=neighbor[bc${i}]`,
          `[bb${i}][bc${i}]overlay=${x}:${y}:enable='between(t,${b.s},${b.e})'[bo${i}]`); vl = `bo${i}`;
      });
      if (clean) { f.push(`[${al}]${AUDIO_FIX}[af]`); al = 'af'; }
      const am = (label) => (al ? ['-map', al === '0:a' ? '0:a' : `[${label}]`] : []);
      if (wantLow) { f.push(`[${vl}]split=2[vh][vq]`, `[vh]${scaleTo(720)}[vo]`, `[vq]${scaleTo(360)}[vlo]`); if (al && al !== '0:a') f.push(`[${al}]asplit=2[ao][alo]`); }
      else { f.push(`[${vl}]${scaleTo(720)}[vo]`); if (al && al !== '0:a') f.push(`[${al}]anull[ao]`); }
      args = ['-y', '-i', src, '-filter_complex', f.join(';'), '-map', '[vo]', ...am('ao'), ...codec(26, '96k'), out, ...(wantLow ? ['-map', '[vlo]', ...am('alo'), ...codec(30, '64k'), low] : [])];
    }
    const r = await run(config.ffmpeg, args);
    if (r.code !== 0 || !fs.existsSync(out)) {
      for (const f of [out, low]) try { fs.unlinkSync(f); } catch { }
      return { ok: false, err: r.err.split('\n').filter(Boolean).pop() || '알 수 없는 오류' };
    }
    if (!wantLow) try { fs.unlinkSync(low); } catch { }
    const d = probe(config.ffprobe, out).duration;
    return { ok: true, duration: d, low: wantLow && fs.existsSync(low), bytes: fs.statSync(out).size + (wantLow && fs.existsSync(low) ? fs.statSync(low).size : 0) };
  }

  async function ingest(v, src) {
    if (!available) {
      fs.renameSync(src, store.paths.media(v.id));
      Object.assign(v, { status: 'ready', bytes: fs.statSync(store.paths.media(v.id)).size, low: false, note: '압축 안 함(ffmpeg 없음)' });
      delete v.incoming; return;
    }
    const keep = v.keep ? cleanRanges(v.keep, probe(config.ffprobe, src).duration || Infinity) : null;   // 올릴 때 고른 "남길 구간"
    const r = await encode(v, src, { ranges: keep, clean: !!v.cleanAudio });
    delete v.keep; delete v.cleanAudio;
    if (!r.ok) { Object.assign(v, { status: 'failed', note: '영상을 변환하지 못했어요: ' + r.err }); return; }
    const thumb = await makeThumb(v.id, Math.min(3, r.duration * 0.1));
    Object.assign(v, { status: 'ready', duration: r.duration, bytes: r.bytes, low: r.low, thumb, thumbVer: Date.now(), note: '' });
    delete v.incoming;
    try { fs.unlinkSync(src); } catch { }
  }

  // 저장된 영상을 다시 만든다(구간 남기기, 가리기). 실패하면 원래 영상으로 되돌린다.
  async function trim(v, opt) {
    const cur = store.paths.media(v.id), tmp = store.paths.incoming(v.id, '_trim.mp4');
    fs.renameSync(cur, tmp);
    const r = await encode(v, tmp, opt);
    if (!r.ok) { fs.renameSync(tmp, cur); Object.assign(v, { status: 'ready', note: '편집하지 못했어요: ' + r.err }); return; }
    if (!v.customThumb) { await makeThumb(v.id, Math.min(3, r.duration * 0.1)); delete v.autoThumb; }   // 자동 썸네일은 새 영상 기준으로 다시 만든다
    Object.assign(v, { status: 'ready', duration: r.duration, bytes: r.bytes, low: r.low, thumbVer: Date.now(), note: '' });
    try { fs.unlinkSync(tmp); } catch { }
  }

  // 소리만 정리한다(화면은 그대로 복사해서 빠르고 화질이 그대로다).
  async function fixAudio(v) {
    for (const f of [store.paths.media(v.id), store.paths.mediaLow(v.id)]) {
      if (!fs.existsSync(f)) continue;
      if (!probe(config.ffprobe, f).audio) { Object.assign(v, { status: 'ready', note: '소리가 없는 영상이에요.' }); return; }
      const tmp = f + '.fix.mp4', r = await run(config.ffmpeg, ['-y', '-i', f, '-c:v', 'copy', '-af', AUDIO_FIX, '-c:a', 'aac', '-b:a', f.endsWith('_360.mp4') ? '64k' : '96k', '-movflags', '+faststart', tmp]);
      if (r.code !== 0 || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { } Object.assign(v, { status: 'ready', note: '소리를 정리하지 못했어요: ' + (r.err.split('\n').filter(Boolean).pop() || '') }); return; }
      fs.renameSync(tmp, f);
    }
    const lowF = store.paths.mediaLow(v.id);
    Object.assign(v, { status: 'ready', note: '', audioFixed: true, thumbVer: Date.now(), bytes: fs.statSync(store.paths.media(v.id)).size + (fs.existsSync(lowF) ? fs.statSync(lowF).size : 0) });
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      const v = store.video(job.id);
      if (!v) { if (job.src) try { fs.unlinkSync(job.src); } catch { } continue; }
      try { if (job.type === 'trim') await trim(v, { ranges: job.ranges }); else if (job.type === 'blur') await trim(v, { boxes: job.boxes }); else if (job.type === 'audio') await fixAudio(v); else await ingest(v, job.src); }
      catch (e) { Object.assign(v, { status: v.status === 'processing' && fs.existsSync(store.paths.media(v.id)) ? 'ready' : 'failed', note: String(e.message) }); }
      store.save();
      if (v.status === 'ready') try { onDone(v, job.type); } catch (e) { log('[순수TV] ' + e.message); }
    }
    busy = false;
  }

  return {
    available, makeThumb,
    enqueue(id, src) { queue.push({ type: 'ingest', id, src }); pump(); },
    enqueueTrim(id, start, end) { queue.push({ type: 'trim', id, ranges: [[start, end]] }); pump(); },
    enqueueCut(id, ranges) { queue.push({ type: 'trim', id, ranges }); pump(); },
    enqueueBlur(id, boxes) { queue.push({ type: 'blur', id, boxes }); pump(); },
    enqueueAudio(id) { queue.push({ type: 'audio', id }); pump(); },
    idle: () => !busy && queue.length === 0
  };
}

module.exports = { createTranscoder, probe, hasFfmpeg, cleanRanges, cleanBoxes };
