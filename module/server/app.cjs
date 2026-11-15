const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createConfig } = require('./config.cjs');
const { createStore } = require('./store.cjs');
const { createTranscoder } = require('./transcode.cjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };

function sendJson(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Cache-Control': 'no-store' });
  res.end(s);
}
const fail = (res, status, message) => sendJson(res, status, { ok: false, message });

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (d) => { buf += d; if (buf.length > limit) { reject(Object.assign(new Error('요청이 너무 커요.'), { statusCode: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(Object.assign(new Error('JSON 형식이 아니에요.'), { statusCode: 400 })); } });
    req.on('error', reject);
  });
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const tagsOf = (s) => [...new Set(String(s ?? '').split(/[,#\s]+/).map((t) => clean(t, 20)).filter(Boolean))].slice(0, 10);

// 파일을 Range 요청에 맞춰 보낸다(영상 건너뛰기용).
async function sendFile(req, res, file, type, cache = 'no-cache') {
  let st;
  try { st = await fsp.stat(file); } catch { return false; }
  if (!st.isFile()) return false;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    let start = range[1] === '' ? Math.max(0, st.size - Number(range[2])) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
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
  const store = createStore(config.dataDir);
  const transcoder = createTranscoder(config, store, overrides.log || console.log);
  const { db } = store;

  // 서버가 꺼졌다 켜지면 변환 중이던 영상을 다시 줄 세운다.
  for (const v of db.videos.filter((x) => x.status === 'processing')) {
    const src = v.incoming && fs.existsSync(v.incoming) ? v.incoming : null;
    if (src) transcoder.enqueue(v.id, src); else Object.assign(v, { status: 'failed', note: '서버가 다시 켜지면서 원본을 잃었어요. 다시 올려 주세요.' });
  }

  const publicVideo = (v) => ({ id: v.id, title: v.title, desc: v.desc, category: v.category, tags: v.tags, created: v.created, status: v.status,
    duration: v.duration || 0, bytes: v.bytes || 0, views: v.views || 0, likes: v.likes || 0, thumb: !!v.thumb, note: v.note || '', comments: store.commentsOf(v.id).length });

  function list(url) {
    const q = clean(url.searchParams.get('q'), 100).toLowerCase(), cat = url.searchParams.get('cat') || '', sort = url.searchParams.get('sort') || 'new';
    let out = db.videos.filter((v) => (!cat || v.category === cat));
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      out = out.filter((v) => { const text = [v.title, v.desc, v.category, ...(v.tags || [])].join(' ').toLowerCase(); return words.every((w) => text.includes(w)); });
    }
    out = [...out].sort(sort === 'views' ? (a, b) => (b.views || 0) - (a.views || 0) : sort === 'likes' ? (a, b) => (b.likes || 0) - (a.likes || 0) : (a, b) => b.created.localeCompare(a.created));
    return out.map(publicVideo);
  }

  async function upload(req, res, url) {
    const filename = clean(url.searchParams.get('filename'), 200), ext = path.extname(filename).toLowerCase();
    const title = clean(url.searchParams.get('title'), 100) || path.basename(filename, ext);
    if (!config.videoExts.includes(ext)) return fail(res, 400, `영상 파일만 올릴 수 있어요 (${config.videoExts.join(' ')})`);
    if (!title) return fail(res, 400, '제목을 적어 주세요.');
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > config.maxBytes) return fail(res, 413, `영상이 너무 커요. 최대 ${(config.maxBytes / 1024 ** 3).toFixed(0)} GB 까지예요.`);
    const id = store.newId(), dest = store.paths.incoming(id, ext);
    let bytes = 0, tooBig = false;
    const ws = fs.createWriteStream(dest);
    req.on('data', (d) => { bytes += d.length; if (bytes > config.maxBytes && !tooBig) { tooBig = true; req.unpipe(ws); ws.destroy(); } });
    req.pipe(ws);
    const done = await new Promise((resolve) => { ws.on('finish', () => resolve(true)); ws.on('error', () => resolve(false)); ws.on('close', () => resolve(!tooBig && ws.writableFinished)); req.on('aborted', () => { ws.destroy(); resolve(false); }); });
    if (!done || tooBig || bytes === 0) {
      fs.unlink(dest, () => { });
      return fail(res, tooBig ? 413 : 400, tooBig ? '영상이 너무 커요.' : '올리기가 중간에 끊겼어요. 다시 시도해 주세요.');
    }
    const cat = url.searchParams.get('cat');
    const v = { id, title, desc: clean(url.searchParams.get('desc'), 2000), category: config.categories.includes(cat) ? cat : '기타', tags: tagsOf(url.searchParams.get('tags')),
      created: new Date().toISOString(), status: 'processing', originalBytes: bytes, incoming: dest, views: 0, likes: 0 };
    db.videos.push(v); store.save();
    transcoder.enqueue(id, dest);
    sendJson(res, 200, { ok: true, video: publicVideo(v) });
  }

  async function diskInfo() {
    const used = db.videos.reduce((s, v) => s + (v.bytes || 0), 0);
    let free = null, total = null;
    try { const st = await fsp.statfs(config.dataDir); free = st.bavail * st.bsize; total = st.blocks * st.bsize; } catch { }
    return { videos: db.videos.length, ready: db.videos.filter((v) => v.status === 'ready').length, usedBytes: used, freeBytes: free, totalBytes: total,
      hours: db.videos.reduce((s, v) => s + (v.duration || 0), 0) / 3600, compress: transcoder.available };
  }

  async function api(req, res, pathname, url) {
    const m = req.method;
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true, module: 'sunsutube', videos: db.videos.length });
    if (pathname === '/api/meta' && m === 'GET') return sendJson(res, 200, { ok: true, categories: config.categories, maxBytes: config.maxBytes, exts: config.videoExts, ...(await diskInfo()) });
    if (pathname === '/api/videos' && m === 'GET') return sendJson(res, 200, { ok: true, videos: list(url) });
    if (pathname === '/api/upload' && (m === 'PUT' || m === 'POST')) return upload(req, res, url);
    const vm = /^\/api\/videos\/([0-9a-f]{12})(\/(view|like|comments)(\/([0-9a-f]{12}))?)?$/.exec(pathname);
    if (!vm) return fail(res, 404, '없는 API 경로입니다.');
    const v = store.video(vm[1]);
    if (!v) return fail(res, 404, '영상을 찾지 못했어요.');
    const sub = vm[3];
    if (!sub) {
      if (m === 'GET') {
        const related = db.videos.filter((x) => x.id !== v.id && x.status === 'ready').map((x) => ({ x, score: (x.category === v.category ? 2 : 0) + (x.tags || []).filter((t) => (v.tags || []).includes(t)).length }))
          .sort((a, b) => b.score - a.score || b.x.created.localeCompare(a.x.created)).slice(0, 8).map((r) => publicVideo(r.x));
        return sendJson(res, 200, { ok: true, video: publicVideo(v), comments: store.commentsOf(v.id), related });
      }
      if (m === 'PATCH') {
        const b = await readJson(req);
        if (b.title !== undefined) { const t = clean(b.title, 100); if (!t) return fail(res, 400, '제목을 적어 주세요.'); v.title = t; }
        if (b.desc !== undefined) v.desc = clean(b.desc, 2000);
        if (b.category !== undefined && config.categories.includes(b.category)) v.category = b.category;
        if (b.tags !== undefined) v.tags = tagsOf(Array.isArray(b.tags) ? b.tags.join(',') : b.tags);
        store.save(); return sendJson(res, 200, { ok: true, video: publicVideo(v) });
      }
      if (m === 'DELETE') {
        db.videos.splice(db.videos.indexOf(v), 1);
        db.comments = db.comments.filter((c) => c.video !== v.id); store.db.comments = db.comments;
        for (const f of [store.paths.media(v.id), store.paths.thumb(v.id), v.incoming]) if (f) fs.unlink(f, () => { });
        store.save(); return sendJson(res, 200, { ok: true });
      }
    }
    if (sub === 'view' && m === 'POST') { v.views = (v.views || 0) + 1; store.save(); return sendJson(res, 200, { ok: true, views: v.views }); }
    if (sub === 'like' && m === 'POST') { v.likes = (v.likes || 0) + 1; store.save(); return sendJson(res, 200, { ok: true, likes: v.likes }); }
    if (sub === 'comments' && m === 'POST' && !vm[5]) {
      const b = await readJson(req), text = clean(b.text, 1000);
      if (!text) return fail(res, 400, '댓글 내용을 적어 주세요.');
      const c = { id: store.newId(), video: v.id, text, at: Number.isFinite(+b.at) ? Math.max(0, +b.at) : null, created: new Date().toISOString() };
      db.comments.push(c); store.save(); return sendJson(res, 200, { ok: true, comment: c });
    }
    if (sub === 'comments' && m === 'DELETE' && vm[5]) {
      const i = db.comments.findIndex((c) => c.id === vm[5] && c.video === v.id);
      if (i < 0) return fail(res, 404, '댓글을 찾지 못했어요.');
      db.comments.splice(i, 1); store.save(); return sendJson(res, 200, { ok: true });
    }
    return fail(res, 405, '지원하지 않는 요청입니다.');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${config.host}:${config.port}`}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/api/')) return await api(req, res, pathname, url);
      let m = /^\/media\/([0-9a-f]{12})\.mp4$/.exec(pathname);
      if (m) { if (await sendFile(req, res, store.paths.media(m[1]), 'video/mp4', 'private, max-age=3600')) return; return fail(res, 404, '영상 파일이 없어요.'); }
      m = /^\/thumb\/([0-9a-f]{12})\.jpg$/.exec(pathname);
      if (m) { if (await sendFile(req, res, store.paths.thumb(m[1]), 'image/jpeg', 'private, max-age=3600')) return; return fail(res, 404, '썸네일이 없어요.'); }
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
