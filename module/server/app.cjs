const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createConfig } = require('./config.cjs');
const { createStore } = require('./store.cjs');
const { createTranscoder } = require('./transcode.cjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };
const ID = '[0-9a-f]{12}';

function sendJson(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store' });
  res.end(s);
}
const fail = (res, status, message) => sendJson(res, status, { ok: false, message });
const err = (status, message) => Object.assign(new Error(message), { statusCode: status });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(err(413, '요청이 너무 커요.')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req, 256 * 1024);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { throw err(400, 'JSON 형식이 아니에요.'); }
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, max);
const tagsOf = (s) => [...new Set(String(Array.isArray(s) ? s.join(',') : s ?? '').split(/[,#\s]+/).map((t) => clean(t, 20)).filter(Boolean))].slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

// 파일을 Range 요청에 맞춰 보낸다(영상 건너뛰기용).
async function sendFile(req, res, file, type, cache = 'no-cache') {
  let st;
  try { st = await fsp.stat(file); } catch { return false; }
  if (!st.isFile()) return false;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] === '' ? Math.max(0, st.size - Number(range[2])) : Number(range[1]);
    const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return true; }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': cache });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
  return true;
}

function createSunsuTubeApp(overrides = {}) {
  const config = createConfig(overrides);
  const store = createStore(config.dataDir, { categories: config.categories });
  const transcoder = createTranscoder(config, store, overrides.log || console.log);
  const { db } = store;

  // 서버가 꺼졌다 켜지면: 변환 중이던 영상을 다시 줄 세우고, 하루 넘은 올리다 만 파일을 치운다.
  for (const v of db.videos.filter((x) => x.status === 'processing')) {
    if (v.incoming && fs.existsSync(v.incoming)) transcoder.enqueue(v.id, v.incoming);
    else if (fs.existsSync(store.paths.media(v.id))) v.status = 'ready';
    else Object.assign(v, { status: 'failed', note: '서버가 다시 켜지면서 원본을 잃었어요. 다시 올려 주세요.' });
  }
  db.uploads = db.uploads.filter((u) => { if (Date.now() - new Date(u.created) < 24 * 3600 * 1000 && fs.existsSync(u.file)) return true; fs.unlink(u.file, () => { }); return false; });

  const weekViews = (v) => { const d = v.viewDays || {}; let n = 0; for (let i = 0; i < 7; i++) n += d[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] || 0; return n; };
  const publicVideo = (v) => ({ id: v.id, title: v.title, desc: v.desc, category: v.category, tags: v.tags, created: v.created, status: v.status,
    duration: v.duration || 0, bytes: v.bytes || 0, views: v.views || 0, weekViews: weekViews(v), likes: v.likes || 0, dislikes: v.dislikes || 0, thumb: !!v.thumb, thumbVer: v.thumbVer || 0,
    low: !!v.low, visibility: v.visibility || 'public', hidden: !!v.hidden, reports: (v.reports || []).length, note: v.note || '', comments: store.commentsOf(v.id).length });
  const listed = (v) => (v.visibility || 'public') === 'public' && !v.hidden;

  function list(url) {
    const q = clean(url.searchParams.get('q'), 100).toLowerCase(), cat = url.searchParams.get('cat') || '', tag = url.searchParams.get('tag') || '', sort = url.searchParams.get('sort') || 'new';
    const all = url.searchParams.get('all') === '1';
    let out = db.videos.filter((v) => (all || listed(v)) && (!cat || v.category === cat) && (!tag || (v.tags || []).includes(tag)));
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      out = out.filter((v) => { const text = [v.title, v.desc, v.category, ...(v.tags || [])].join(' ').toLowerCase(); return words.every((w) => text.includes(w)); });
    }
    const by = { views: (a, b) => (b.views || 0) - (a.views || 0), likes: (a, b) => (b.likes || 0) - (a.likes || 0), week: (a, b) => weekViews(b) - weekViews(a) || (b.views || 0) - (a.views || 0),
      size: (a, b) => (b.bytes || 0) - (a.bytes || 0), reports: (a, b) => (b.reports || []).length - (a.reports || []).length }[sort] || ((a, b) => b.created.localeCompare(a.created));
    const ids = url.searchParams.get('ids');
    if (ids !== null) { const want = ids.split(',').filter(Boolean); return want.map((id) => store.video(id)).filter((v) => v && (all || !v.hidden)).map(publicVideo); }
    return [...out].sort(by).map(publicVideo);
  }

  function newVideo(id, meta, bytes, incoming) {
    const title = clean(meta.title, 100) || clean(path.basename(meta.filename || '', path.extname(meta.filename || '')), 100);
    return { id, title, desc: cleanText(meta.desc, 2000), category: db.categories.includes(meta.cat) ? meta.cat : db.categories[db.categories.length - 1], tags: tagsOf(meta.tags),
      visibility: meta.visibility === 'unlisted' ? 'unlisted' : 'public', created: new Date().toISOString(), status: 'processing', originalBytes: bytes, incoming, views: 0, likes: 0, dislikes: 0 };
  }
  function checkUpload(filename, size) {
    const ext = path.extname(clean(filename, 200)).toLowerCase();
    if (!config.videoExts.includes(ext)) throw err(400, `영상 파일만 올릴 수 있어요 (${config.videoExts.join(' ')})`);
    if (size > config.maxBytes) throw err(413, `영상이 너무 커요. 최대 ${(config.maxBytes / 1024 ** 3).toFixed(0)} GB 까지예요.`);
    return ext;
  }

  // 요청 본문을 파일에 쓴다(append 면 이어 붙임). 넘치면 끊는다. 돌려주는 값: 쓴 바이트 수 또는 -1(넘침)/-2(끊김)
  function pipeToFile(req, dest, append, maxTotal, already = 0) {
    return new Promise((resolve) => {
      let bytes = 0, over = false, settled = false;
      const ws = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      req.on('data', (d) => { bytes += d.length; if (already + bytes > maxTotal && !over) { over = true; req.unpipe(ws); process.nextTick(() => ws.end()); } });   // 이 조각은 이미 쓰는 중이라 다음 틱에 닫는다(넘친 만큼은 부른 쪽이 잘라 낸다)
      req.on('aborted', () => { ws.end(); done(-2); });
      ws.on('error', () => done(-2));
      ws.on('finish', () => done(over ? -1 : bytes));
      req.pipe(ws);
    });
  }

  // 한 번에 올리기(작은 파일·시험용)
  async function uploadWhole(req, res, url) {
    const filename = url.searchParams.get('filename') || '';
    const ext = checkUpload(filename, Number(req.headers['content-length'] || 0));
    const id = store.newId(), dest = store.paths.incoming(id, ext);
    const n = await pipeToFile(req, dest, false, config.maxBytes);
    if (n <= 0) { fs.unlink(dest, () => { }); return fail(res, n === -1 ? 413 : 400, n === -1 ? '영상이 너무 커요.' : '올리기가 중간에 끊겼어요. 다시 시도해 주세요.'); }
    const v = newVideo(id, Object.fromEntries(url.searchParams), n, dest);
    if (!v.title) { fs.unlink(dest, () => { }); return fail(res, 400, '제목을 적어 주세요.'); }
    db.videos.push(v); store.save(); transcoder.enqueue(id, dest);
    sendJson(res, 200, { ok: true, video: publicVideo(v) });
  }

  // 끊겨도 이어 올리기: 시작(POST /api/uploads) → 조각(PUT ?offset=) → 다 차면 영상으로 등록
  async function uploads(req, res, pathname, url) {
    const m = req.method, um = new RegExp(`^/api/uploads/(${ID})$`).exec(pathname);
    if (pathname === '/api/uploads' && m === 'POST') {
      const b = await readJson(req), size = Number(b.size);
      if (!Number.isFinite(size) || size <= 0) throw err(400, '파일 크기를 알 수 없어요.');
      const ext = checkUpload(b.filename, size);
      const id = store.newId(), file = store.paths.incoming(id, ext);
      fs.writeFileSync(file, '');
      db.uploads.push({ id, file, size, received: 0, created: new Date().toISOString(), meta: { filename: clean(b.filename, 200), title: b.title, cat: b.cat, desc: b.desc, tags: b.tags, visibility: b.visibility } });
      store.save(); return sendJson(res, 200, { ok: true, uploadId: id, received: 0 });
    }
    if (!um) return fail(res, 404, '없는 API 경로입니다.');
    const u = db.uploads.find((x) => x.id === um[1]);
    if (!u) return fail(res, 404, '올리던 기록을 찾지 못했어요. 처음부터 다시 올려 주세요.');
    if (m === 'GET') return sendJson(res, 200, { ok: true, received: u.received, size: u.size });
    if (m === 'DELETE') { db.uploads.splice(db.uploads.indexOf(u), 1); fs.unlink(u.file, () => { }); store.save(); return sendJson(res, 200, { ok: true }); }
    if (m === 'PUT') {
      const offset = Number(url.searchParams.get('offset'));
      if (offset !== u.received) { req.resume(); return sendJson(res, 409, { ok: false, message: '이어 올릴 위치가 달라요.', received: u.received }); }
      const n = await pipeToFile(req, u.file, true, u.size, u.received);
      const actual = fs.existsSync(u.file) ? fs.statSync(u.file).size : 0;
      if (n === -1) { fs.truncateSync(u.file, u.received); return fail(res, 413, '보낸 양이 파일 크기보다 커요.'); }
      u.received = actual; store.save();
      if (n === -2) return sendJson(res, 400, { ok: false, message: '조각이 중간에 끊겼어요.', received: u.received });
      if (u.received < u.size) return sendJson(res, 200, { ok: true, received: u.received, done: false });
      const v = newVideo(u.id, u.meta, u.size, u.file);
      if (!v.title) v.title = '제목 없음';
      db.uploads.splice(db.uploads.indexOf(u), 1); db.videos.push(v); store.save(); transcoder.enqueue(v.id, u.file);
      return sendJson(res, 200, { ok: true, received: u.size, done: true, video: publicVideo(v) });
    }
    return fail(res, 405, '지원하지 않는 요청입니다.');
  }

  async function diskInfo() {
    const used = db.videos.reduce((s, v) => s + (v.bytes || 0), 0);
    let free = null, total = null;
    try { const st = await fsp.statfs(config.dataDir); free = st.bavail * st.bsize; total = st.blocks * st.bsize; } catch { }
    return { videos: db.videos.length, ready: db.videos.filter((v) => v.status === 'ready').length, usedBytes: used, freeBytes: free, totalBytes: total,
      hours: db.videos.reduce((s, v) => s + (v.duration || 0), 0) / 3600, compress: transcoder.available };
  }

  function removeVideo(v) {
    db.videos.splice(db.videos.indexOf(v), 1);
    for (let i = db.comments.length - 1; i >= 0; i--) if (db.comments[i].video === v.id) db.comments.splice(i, 1);
    for (const p of db.playlists) p.videos = p.videos.filter((x) => x !== v.id);
    for (const f of [store.paths.media(v.id), store.paths.mediaLow(v.id), store.paths.thumb(v.id), v.incoming]) if (f) fs.unlink(f, () => { });
  }

  const publicPlaylist = (p, full) => {
    const vids = p.videos.map((id) => store.video(id)).filter((v) => v && !v.hidden);
    return { id: p.id, title: p.title, desc: p.desc || '', created: p.created, count: vids.length, duration: vids.reduce((s, v) => s + (v.duration || 0), 0),
      cover: (vids.find((v) => v.thumb) || {}).id || null, ...(full ? { videos: vids.map(publicVideo) } : { ids: vids.map((v) => v.id) }) };
  };

  async function playlists(req, res, pathname) {
    const m = req.method;
    if (pathname === '/api/playlists') {
      if (m === 'GET') return sendJson(res, 200, { ok: true, playlists: db.playlists.map((p) => publicPlaylist(p)).sort((a, b) => b.created.localeCompare(a.created)) });
      if (m === 'POST') { const b = await readJson(req), title = clean(b.title, 80); if (!title) throw err(400, '재생 목록 이름을 적어 주세요.');
        const p = { id: store.newId(), title, desc: cleanText(b.desc, 500), videos: [], created: new Date().toISOString() }; db.playlists.push(p); store.save(); return sendJson(res, 200, { ok: true, playlist: publicPlaylist(p) }); }
    }
    const pm = new RegExp(`^/api/playlists/(${ID})(/videos(/(${ID}))?)?$`).exec(pathname);
    if (!pm) return fail(res, 404, '없는 API 경로입니다.');
    const p = store.playlist(pm[1]); if (!p) return fail(res, 404, '재생 목록을 찾지 못했어요.');
    if (!pm[2]) {
      if (m === 'GET') return sendJson(res, 200, { ok: true, playlist: publicPlaylist(p, true) });
      if (m === 'PATCH') { const b = await readJson(req);
        if (b.title !== undefined) { const t = clean(b.title, 80); if (!t) throw err(400, '재생 목록 이름을 적어 주세요.'); p.title = t; }
        if (b.desc !== undefined) p.desc = cleanText(b.desc, 500);
        if (Array.isArray(b.videos)) { const keep = b.videos.filter((id) => p.videos.includes(id)); p.videos = [...new Set([...keep, ...p.videos.filter((id) => !keep.includes(id))])]; }
        store.save(); return sendJson(res, 200, { ok: true, playlist: publicPlaylist(p, true) }); }
      if (m === 'DELETE') { db.playlists.splice(db.playlists.indexOf(p), 1); store.save(); return sendJson(res, 200, { ok: true }); }
    } else if (!pm[4] && m === 'POST') {
      const b = await readJson(req); if (!store.video(b.video)) throw err(404, '영상을 찾지 못했어요.');
      if (!p.videos.includes(b.video)) p.videos.push(b.video); store.save(); return sendJson(res, 200, { ok: true, playlist: publicPlaylist(p) });
    } else if (pm[4] && m === 'DELETE') { p.videos = p.videos.filter((id) => id !== pm[4]); store.save(); return sendJson(res, 200, { ok: true, playlist: publicPlaylist(p) }); }
    return fail(res, 405, '지원하지 않는 요청입니다.');
  }

  async function videoApi(req, res, vm) {
    const m = req.method, v = store.video(vm[1]);
    if (!v) return fail(res, 404, '영상을 찾지 못했어요.');
    const sub = vm[3], cid = vm[5];
    if (!sub) {
      if (m === 'GET') {
        const related = db.videos.filter((x) => x.id !== v.id && x.status === 'ready' && listed(x)).map((x) => ({ x, score: (x.category === v.category ? 2 : 0) + (x.tags || []).filter((t) => (v.tags || []).includes(t)).length }))
          .sort((a, b) => b.score - a.score || b.x.created.localeCompare(a.x.created)).slice(0, 10).map((r) => publicVideo(r.x));
        return sendJson(res, 200, { ok: true, video: publicVideo(v), comments: store.commentsOf(v.id), related, playlists: db.playlists.filter((p) => p.videos.includes(v.id)).map((p) => p.id) });
      }
      if (m === 'PATCH') {
        const b = await readJson(req);
        if (b.title !== undefined) { const t = clean(b.title, 100); if (!t) throw err(400, '제목을 적어 주세요.'); v.title = t; }
        if (b.desc !== undefined) v.desc = cleanText(b.desc, 2000);
        if (b.category !== undefined && db.categories.includes(b.category)) v.category = b.category;
        if (b.tags !== undefined) v.tags = tagsOf(b.tags);
        if (b.visibility === 'public' || b.visibility === 'unlisted') v.visibility = b.visibility;
        if (typeof b.hidden === 'boolean') v.hidden = b.hidden;
        if (b.clearReports) v.reports = [];
        store.save(); return sendJson(res, 200, { ok: true, video: publicVideo(v) });
      }
      if (m === 'DELETE') { removeVideo(v); store.save(); return sendJson(res, 200, { ok: true }); }
    }
    if (sub === 'view' && m === 'POST') { v.views = (v.views || 0) + 1; const d = v.viewDays = v.viewDays || {}; d[today()] = (d[today()] || 0) + 1; for (const k of Object.keys(d).sort().slice(0, -30)) delete d[k]; store.save(); return sendJson(res, 200, { ok: true, views: v.views }); }
    if ((sub === 'like' || sub === 'dislike') && m === 'POST') {
      const b = await readJson(req), key = sub === 'like' ? 'likes' : 'dislikes';
      v[key] = Math.max(0, (v[key] || 0) + (b.undo ? -1 : 1)); store.save(); return sendJson(res, 200, { ok: true, likes: v.likes || 0, dislikes: v.dislikes || 0 });
    }
    if (sub === 'report' && m === 'POST') { const b = await readJson(req), reason = clean(b.reason, 200); if (!reason) throw err(400, '신고 이유를 적어 주세요.');
      (v.reports = v.reports || []).push({ reason, at: new Date().toISOString() }); store.save(); return sendJson(res, 200, { ok: true }); }
    if (sub === 'reports' && m === 'GET') return sendJson(res, 200, { ok: true, reports: v.reports || [] });
    if (sub === 'thumb') {
      if (v.status !== 'ready' || !transcoder.available) throw err(400, transcoder.available ? '영상 변환이 끝난 뒤에 바꿀 수 있어요.' : 'ffmpeg 가 없어 썸네일을 만들 수 없어요.');
      if (m === 'POST') { const b = await readJson(req), t = Number(b.t); if (!Number.isFinite(t) || t < 0 || t > (v.duration || 0)) throw err(400, '영상 길이 안의 시간을 골라 주세요.');
        if (!await transcoder.makeThumb(v.id, t)) throw err(500, '그 장면으로 썸네일을 만들지 못했어요.'); }
      else if (m === 'PUT') { if (!/^image\//.test(req.headers['content-type'] || '')) throw err(400, '사진 파일(JPG, PNG)을 올려 주세요.');
        const tmp = store.paths.incoming(v.id, '_thumb'); fs.writeFileSync(tmp, await readBody(req, 10 * 1024 * 1024));
        const okT = await transcoder.makeThumb(v.id, 0, tmp); fs.unlink(tmp, () => { }); if (!okT) throw err(400, '사진을 읽지 못했어요. JPG 나 PNG 로 올려 주세요.'); }
      else return fail(res, 405, '지원하지 않는 요청입니다.');
      Object.assign(v, { thumb: true, customThumb: true, thumbVer: Date.now() }); store.save(); return sendJson(res, 200, { ok: true, video: publicVideo(v) });
    }
    if (sub === 'trim' && m === 'POST') {
      if (v.status !== 'ready' || !transcoder.available) throw err(400, transcoder.available ? '영상 변환이 끝난 뒤에 자를 수 있어요.' : 'ffmpeg 가 없어 자를 수 없어요.');
      const b = await readJson(req), s = Number(b.start), e = Number(b.end);
      if (!(s >= 0) || !(e > s + 0.5) || e > (v.duration || 0) + 0.5) throw err(400, '시작과 끝을 영상 길이 안에서, 끝이 시작보다 뒤가 되게 골라 주세요.');
      v.status = 'processing'; store.save(); transcoder.enqueueTrim(v.id, s, Math.min(e, v.duration)); return sendJson(res, 200, { ok: true, video: publicVideo(v) });
    }
    if (sub === 'comments') {
      if (m === 'POST' && !cid) {
        const b = await readJson(req), text = cleanText(b.text, 1000); if (!text) throw err(400, '댓글 내용을 적어 주세요.');
        const parent = b.parent && db.comments.find((c) => c.id === b.parent && c.video === v.id && !c.parent) ? b.parent : null;
        const c = { id: store.newId(), video: v.id, parent, text, at: b.at != null && Number.isFinite(+b.at) ? Math.max(0, +b.at) : null, likes: 0, created: new Date().toISOString() };
        db.comments.push(c); store.save(); return sendJson(res, 200, { ok: true, comment: c });
      }
      const c = cid && db.comments.find((x) => x.id === cid && x.video === v.id);
      if (!c) return fail(res, 404, '댓글을 찾지 못했어요.');
      if (m === 'DELETE') { for (let i = db.comments.length - 1; i >= 0; i--) if (db.comments[i].id === cid || db.comments[i].parent === cid) db.comments.splice(i, 1); store.save(); return sendJson(res, 200, { ok: true }); }
      if (m === 'POST' && vm[7] === 'like') { const b = await readJson(req); c.likes = Math.max(0, (c.likes || 0) + (b.undo ? -1 : 1)); store.save(); return sendJson(res, 200, { ok: true, likes: c.likes }); }
    }
    return fail(res, 405, '지원하지 않는 요청입니다.');
  }

  async function api(req, res, pathname, url) {
    const m = req.method;
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true, module: 'sunsutube', videos: db.videos.length });
    if (pathname === '/api/meta' && m === 'GET') return sendJson(res, 200, { ok: true, categories: db.categories, maxBytes: config.maxBytes, exts: config.videoExts, ...(await diskInfo()) });
    if (pathname === '/api/videos' && m === 'GET') return sendJson(res, 200, { ok: true, videos: list(url) });
    if (pathname === '/api/upload' && (m === 'PUT' || m === 'POST')) return uploadWhole(req, res, url);
    if (pathname.startsWith('/api/uploads')) return uploads(req, res, pathname, url);
    if (pathname.startsWith('/api/playlists')) return playlists(req, res, pathname);
    if (pathname === '/api/categories' && m === 'PUT') {
      const b = await readJson(req), next = [...new Set((b.categories || []).map((c) => clean(c, 20)).filter(Boolean))].slice(0, 30);
      if (!next.length) throw err(400, '분류를 하나 이상 남겨 주세요.');
      const rename = b.rename && typeof b.rename === 'object' ? b.rename : {};
      for (const v of db.videos) { if (rename[v.category] && next.includes(rename[v.category])) v.category = rename[v.category]; else if (!next.includes(v.category)) v.category = next[next.length - 1]; }
      db.categories.splice(0, db.categories.length, ...next); store.save(); return sendJson(res, 200, { ok: true, categories: db.categories });
    }
    if (pathname === '/api/admin/delete' && m === 'POST') {
      const b = await readJson(req); let n = 0;
      for (const id of Array.isArray(b.ids) ? b.ids : []) { const v = store.video(id); if (v) { removeVideo(v); n++; } }
      store.save(); return sendJson(res, 200, { ok: true, deleted: n });
    }
    const vm = new RegExp(`^/api/videos/(${ID})(/(view|like|dislike|report|reports|thumb|trim|comments)(/(${ID})(/(like))?)?)?$`).exec(pathname);
    if (vm) return videoApi(req, res, vm);
    return fail(res, 404, '없는 API 경로입니다.');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${config.host}:${config.port}`}`);
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }
    try {
      if (pathname.startsWith('/api/')) return await api(req, res, pathname, url);
      let m = new RegExp(`^/media/(${ID})(_360)?\\.mp4$`).exec(pathname);
      if (m) { if (await sendFile(req, res, m[2] ? store.paths.mediaLow(m[1]) : store.paths.media(m[1]), 'video/mp4', 'private, max-age=3600')) return; return fail(res, 404, '영상 파일이 없어요.'); }
      m = new RegExp(`^/thumb/(${ID})\\.jpg$`).exec(pathname);
      if (m) { if (await sendFile(req, res, store.paths.thumb(m[1]), 'image/jpeg', 'private, max-age=86400')) return; return fail(res, 404, '썸네일이 없어요.'); }
      const target = path.resolve(config.webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (target.startsWith(path.resolve(config.webRoot) + path.sep) && await sendFile(req, res, target, TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream')) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('찾을 수 없습니다.');
    } catch (error) {
      if (!res.headersSent) fail(res, error.statusCode || 500, error.message || '서버 오류');
      else res.destroy();
    }
  });
  server.on('close', () => store.flush());
  return { config, server, store, transcoder };
}

module.exports = { createSunsuTubeApp };
