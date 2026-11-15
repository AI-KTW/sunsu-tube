const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// 라이브: 방송하는 브라우저가 1초마다 보내는 영상 조각을 ffmpeg 에 흘려 넣어, 2초짜리 조각 목록(HLS)으로 만든다.
// 보는 화면은 그 목록을 따라가며 재생한다(실제보다 5~10초 늦다). 방송이 끝나면 한 편의 영상으로 합쳐 일반 영상처럼 변환한다.
const scale = "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'";
const run = (cmd, args) => new Promise((resolve) => { let p; try { p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); } catch (e) { return resolve({ code: -1, err: e.message }); }
  let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-1500); }); p.on('error', (e) => resolve({ code: -1, err: e.message })); p.on('exit', (code) => resolve({ code, err })); });

function createLive(config, store, transcoder, log = console.log) {
  const sessions = new Map(), root = path.join(config.dataDir, 'live');
  fs.mkdirSync(root, { recursive: true });
  const dirOf = (id) => path.join(root, id);
  const clear = (id) => { if (/^[0-9a-f]{12}$/.test(id)) fs.rm(dirOf(id), { recursive: true, force: true }, () => { }); };

  function start(v, hasAudio) {
    const dir = dirOf(v.id); fs.mkdirSync(dir, { recursive: true });
    const args = ['-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-i', 'pipe:0', ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),   // 소리가 없는 방송에는 조용한 소리를 넣어 형식을 맞춘다
      '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0', '-vf', scale + ',fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-level', '3.1', '-pix_fmt', 'yuv420p',
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-b:v', '1800k', '-maxrate', '2200k', '-bufsize', '3600k', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '96k', ...(hasAudio ? [] : ['-shortest']),
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', path.join(dir, 'seg%05d.m4s'), path.join(dir, 'live.m3u8')];
    const proc = spawn(config.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true }), s = { proc, last: Date.now(), err: '', ending: false, thumbed: false };
    proc.stderr.on('data', (d) => { s.err = (s.err + d).slice(-1500); }); proc.stdin.on('error', () => { });
    s.done = new Promise((resolve) => { proc.on('exit', resolve); proc.on('error', resolve); });
    s.done.then(() => { if (!s.ending) end(v); });   // ffmpeg 가 먼저 죽으면 방송을 끝낸다
    s.idle = setInterval(() => { if (Date.now() - s.last > config.liveIdleMs) end(v); }, 3000);   // 방송하던 화면이 그냥 닫히면 알아서 끝낸다
    sessions.set(v.id, s);
  }

  function write(v, buf) {
    const s = sessions.get(v.id); if (!s || s.ending) return Promise.resolve(false); s.last = Date.now();
    if (!s.thumbed && fs.existsSync(path.join(dirOf(v.id), 'seg00001.m4s'))) { s.thumbed = true;   // 방송 첫 장면을 썸네일로
      run(config.ffmpeg, ['-y', '-loglevel', 'error', '-i', path.join(dirOf(v.id), 'live.m3u8'), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', store.paths.thumb(v.id)]).then((r) => { if (r.code === 0 && store.video(v.id)) { v.thumb = true; v.thumbVer = Date.now(); store.save(); } }); }
    return new Promise((resolve) => { try { s.proc.stdin.write(buf, (e) => resolve(!e)); } catch { resolve(false); } });
  }

  // 방송을 끝내고, 지금까지의 조각을 한 편으로 합쳐 일반 영상 변환 줄에 넣는다.
  async function finalize(v) {
    const dir = dirOf(v.id), list = path.join(dir, 'live.m3u8'), out = store.paths.incoming(v.id, '_live.mp4');
    delete v.liveKey; delete v.kind; v.liveEnded = new Date().toISOString();
    const ok = fs.existsSync(list) && fs.existsSync(path.join(dir, 'seg00000.m4s')) && (await run(config.ffmpeg, ['-y', '-loglevel', 'error', '-i', list, '-c', 'copy', '-movflags', '+faststart', out])).code === 0 && fs.existsSync(out);
    if (!store.video(v.id)) { clear(v.id); try { fs.unlinkSync(out); } catch { } return; }
    if (ok) { Object.assign(v, { status: 'processing', incoming: out, wasLive: true, note: '' }); store.save(); transcoder.enqueue(v.id, out); }
    else { Object.assign(v, { status: 'failed', note: '방송 내용이 저장되지 않았어요(너무 짧았거나 영상이 들어오지 않았어요).' }); store.save(); }
    clear(v.id);
  }
  async function end(v) {
    const s = sessions.get(v.id); if (!s) return; if (s.ending) return s.ending; clearInterval(s.idle);
    s.ending = (async () => { try { s.proc.stdin.end(); } catch { } const t = setTimeout(() => { try { s.proc.kill('SIGKILL'); } catch { } }, 20000); await s.done; clearTimeout(t);
      if (s.err.trim()) log('[순수TV] 라이브 변환 메시지: ' + s.err.trim().split('\n').pop()); sessions.delete(v.id); await finalize(v); })();
    return s.ending;
  }
  function drop(id) { const s = sessions.get(id); if (s) { clearInterval(s.idle); s.ending = Promise.resolve(); try { s.proc.kill('SIGKILL'); } catch { } sessions.delete(id); } clear(id); }

  return { start, write, end, drop, dirOf, active: (id) => sessions.has(id), idle: () => sessions.size === 0,
    // 서버가 꺼졌다 켜졌을 때: 방송 중이던 것은 그때까지 받은 것으로 마무리한다
    recover() { for (const v of store.db.videos.filter((x) => x.status === 'live')) finalize(v); } };
}

module.exports = { createLive };
