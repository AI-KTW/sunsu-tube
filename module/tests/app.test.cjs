const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSunsuTvApp } = require('../server/app.cjs');

const hasFf = spawnSync('ffmpeg', ['-version']).status === 0;
function sample(dir, name = 'in.mp4', size = '1920x1080') {
  const f = path.join(dir, name);
  const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=duration=3:size=${size}:rate=15`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-crf', '10', '-c:a', 'aac', '-shortest', f]);
  assert.equal(r.status, 0, 'ffmpeg 로 시험 영상을 만들지 못함');
  return f;
}
async function start(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunsutv-'));
  const app = createSunsuTvApp({ dataDir, port: 0, log: () => { }, ...opts });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const j = async (p, o) => { const r = await fetch(base + p, o); return { status: r.status, body: await r.json() }; };
  const waitReady = async (id) => { for (let i = 0; i < 100; i++) { const r = await j('/api/videos/' + id); if (r.body.video.status !== 'processing') return r.body.video; await new Promise((s) => setTimeout(s, 200)); } throw new Error('변환이 끝나지 않음'); };
  return { app, base, j, dataDir, waitReady, stop: () => new Promise((r) => app.server.close(r)) };
}

test('올리기 → 720p 압축 → 목록·검색·재생(Range)·조회·좋아요·댓글·수정·삭제', { skip: !hasFf }, async () => {
  const s = await start();
  try {
    const src = sample(s.dataDir);
    const q = new URLSearchParams({ filename: '제수밸브 교체.mp4', title: '3가압장 제수밸브 교체', cat: '작업 기록', desc: '순서와 주의점', tags: '제수밸브, 150A' });
    const up = await s.j('/api/upload?' + q, { method: 'PUT', body: fs.readFileSync(src) });
    assert.equal(up.status, 200); assert.equal(up.body.video.status, 'processing');
    const id = up.body.video.id;
    const v = await s.waitReady(id);
    assert.equal(v.status, 'ready'); assert.ok(v.duration > 2.5 && v.duration < 3.5); assert.ok(v.thumb); assert.ok(v.bytes > 0 && fs.statSync(path.join(s.dataDir, 'media', id + '.mp4')).size < fs.statSync(src).size, '압축해서 작아져야 함'); assert.equal(v.low, true); assert.ok(fs.existsSync(path.join(s.dataDir, 'media', id + '_360.mp4')));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(s.dataDir, 'media', id + '.mp4')], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim(), '1280,720');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'incoming', id + '.mp4')), '원본은 지운다');
    // 목록·검색
    assert.equal((await s.j('/api/videos')).body.videos.length, 1);
    assert.equal((await s.j('/api/videos?q=' + encodeURIComponent('제수밸브 150A'))).body.videos.length, 1);
    assert.equal((await s.j('/api/videos?q=' + encodeURIComponent('펌프'))).body.videos.length, 0);
    assert.equal((await s.j('/api/videos?cat=' + encodeURIComponent('안내'))).body.videos.length, 0);
    // 재생: 전체와 일부(Range)
    const full = await fetch(`${s.base}/media/${id}.mp4`); assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4'); await full.arrayBuffer();
    const part = await fetch(`${s.base}/media/${id}.mp4`, { headers: { Range: 'bytes=100-199' } }); assert.equal(part.status, 206); assert.equal((await part.arrayBuffer()).byteLength, 100); assert.match(part.headers.get('content-range'), /^bytes 100-199\/\d+$/);
    assert.equal((await fetch(`${s.base}/thumb/${id}.jpg`)).status, 200);
    // 조회·좋아요·댓글
    assert.equal((await s.j(`/api/videos/${id}/view`, { method: 'POST' })).body.views, 1);
    assert.equal((await s.j(`/api/videos/${id}/like`, { method: 'POST' })).body.likes, 1);
    const c = await s.j(`/api/videos/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '여기서 토크 얼마로 조여요?', at: 2 }) });
    assert.equal(c.status, 200); assert.equal(c.body.comment.at, 2);
    assert.equal((await s.j(`/api/videos/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '  ' }) })).status, 400);
    let d = await s.j('/api/videos/' + id); assert.equal(d.body.comments.length, 1); assert.equal(d.body.video.comments, 1);
    // 수정
    const p = await s.j('/api/videos/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '제수밸브 교체(개정)', tags: '밸브 교체' }) });
    assert.equal(p.body.video.title, '제수밸브 교체(개정)'); assert.deepEqual(p.body.video.tags, ['밸브', '교체']);
    // 저장 파일에 남는지(재시작 대비)
    s.app.store.flush(); assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'sunsutv.json'), 'utf8')).videos[0].title, '제수밸브 교체(개정)');
    // 통계
    const meta = (await s.j('/api/meta')).body; assert.equal(meta.videos, 1); assert.ok(meta.usedBytes > 0); assert.ok(meta.categories.includes('안내'));
    // 삭제
    assert.equal((await s.j(`/api/videos/${id}/comments/${c.body.comment.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await s.j('/api/videos/' + id, { method: 'DELETE' })).status, 200);
    assert.equal((await s.j('/api/videos')).body.videos.length, 0);
    await new Promise((r) => setTimeout(r, 100)); assert.ok(!fs.existsSync(path.join(s.dataDir, 'media', id + '.mp4')));
  } finally { await s.stop(); }
});

test('세로 영상은 짧은 변 720 으로', { skip: !hasFf }, async () => {
  const s = await start();
  try {
    const src = sample(s.dataDir, 'v.mp4', '1080x1920');
    const up = await s.j('/api/upload?' + new URLSearchParams({ filename: 'v.mp4', title: '세로' }), { method: 'PUT', body: fs.readFileSync(src) });
    const v = await s.waitReady(up.body.video.id); assert.equal(v.status, 'ready');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(s.dataDir, 'media', v.id + '.mp4')], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim(), '720,1280');
  } finally { await s.stop(); }
});

test('잘못된 올리기와 경로는 거절', async () => {
  const s = await start({ maxGb: 0.000001 });
  try {
    assert.equal((await s.j('/api/upload?' + new URLSearchParams({ filename: 'a.exe', title: 'x' }), { method: 'PUT', body: 'abc' })).status, 400);
    assert.equal((await s.j('/api/upload?' + new URLSearchParams({ filename: 'a.mp4', title: 'x' }), { method: 'PUT', body: Buffer.alloc(5000) })).status, 413);
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'incoming')).length, 0, '거절한 파일은 남기지 않는다');
    assert.equal((await s.j('/api/videos/000000000000')).status, 404);
    assert.equal((await s.j('/api/nope')).status, 404);
    assert.equal((await fetch(s.base + '/media/..%2F..%2Fsunsutv.json')).status, 404);
    assert.equal((await fetch(s.base + '/..%2Fserver%2Fapp.cjs')).status, 404);
    assert.equal((await fetch(s.base + '/')).status, 200);
    assert.equal((await s.j('/api/health')).body.ok, true);
  } finally { await s.stop(); }
});

test('변환할 수 없는 파일은 실패로 표시', { skip: !hasFf }, async () => {
  const s = await start();
  try {
    const up = await s.j('/api/upload?' + new URLSearchParams({ filename: 'bad.mp4', title: '깨진 파일' }), { method: 'PUT', body: Buffer.from('이건 영상이 아니에요') });
    const v = await s.waitReady(up.body.video.id); assert.equal(v.status, 'failed'); assert.match(v.note, /변환하지 못했어요/);
  } finally { await s.stop(); }
});

test('ffmpeg 가 없으면 원본 그대로 저장', async () => {
  const s = await start({ ffmpeg: 'no-such-ffmpeg-binary' });
  try {
    const up = await s.j('/api/upload?' + new URLSearchParams({ filename: 'raw.mp4', title: '원본' }), { method: 'PUT', body: Buffer.alloc(2048, 1) });
    const v = await s.waitReady(up.body.video.id); assert.equal(v.status, 'ready'); assert.equal(v.bytes, 2048); assert.match(v.note, /압축 안 함/);
    assert.equal((await s.j('/api/meta')).body.compress, false);
  } finally { await s.stop(); }
});

const J = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const dims = (f) => spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim();

test('화질 360p, 썸네일 고르기, 잘라내기', { skip: !hasFf }, async () => {
  const s = await start();
  try {
    const src = sample(s.dataDir);
    const up = await s.j('/api/upload?' + new URLSearchParams({ filename: 'a.mp4', title: '원본 3초' }), { method: 'PUT', body: fs.readFileSync(src) });
    const id = up.body.video.id; let v = await s.waitReady(id);
    assert.equal(dims(path.join(s.dataDir, 'media', id + '_360.mp4')), '640,360');
    const low = await fetch(`${s.base}/media/${id}_360.mp4`, { headers: { Range: 'bytes=0-9' } }); assert.equal(low.status, 206); await low.arrayBuffer();
    // 썸네일: 장면에서
    const t0 = fs.readFileSync(path.join(s.dataDir, 'thumbs', id + '.jpg'));
    const r = await s.j(`/api/videos/${id}/thumb`, J({ t: 2.5 })); assert.equal(r.status, 200); assert.ok(r.body.video.thumbVer > v.thumbVer);
    assert.ok(!t0.equals(fs.readFileSync(path.join(s.dataDir, 'thumbs', id + '.jpg'))), '다른 장면이면 썸네일이 달라야 함');
    assert.equal((await s.j(`/api/videos/${id}/thumb`, J({ t: 99 }))).status, 400);
    // 썸네일: 사진 올리기
    const png = path.join(s.dataDir, 'p.png'); spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=800x600', '-frames:v', '1', png]);
    const pr = await fetch(`${s.base}/api/videos/${id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: fs.readFileSync(png) }); assert.equal(pr.status, 200);
    assert.equal(dims(path.join(s.dataDir, 'thumbs', id + '.jpg')), '640,480');
    assert.equal((await fetch(`${s.base}/api/videos/${id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: 'not an image' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/videos/${id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 400);
    // 잘라내기 1~2초
    assert.equal((await s.j(`/api/videos/${id}/trim`, J({ start: 2, end: 1 }))).status, 400);
    const tr = await s.j(`/api/videos/${id}/trim`, J({ start: 1, end: 2 })); assert.equal(tr.body.video.status, 'processing');
    v = await s.waitReady(id); assert.equal(v.status, 'ready'); assert.ok(v.duration > 0.8 && v.duration < 1.4, '길이 ' + v.duration);
    assert.equal(dims(path.join(s.dataDir, 'thumbs', id + '.jpg')), '640,480', '직접 고른 썸네일은 유지');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'incoming', id + '_trim.mp4')));
  } finally { await s.stop(); }
});

test('끊겨도 이어 올리기', { skip: !hasFf }, async () => {
  const s = await start();
  try {
    const buf = fs.readFileSync(sample(s.dataDir)), half = Math.floor(buf.length / 2);
    const init = await s.j('/api/uploads', J({ filename: '큰 영상.mp4', size: buf.length, title: '이어 올린 영상', tags: 'a,b', visibility: 'unlisted' }));
    const uid = init.body.uploadId; assert.equal(init.status, 200);
    let r = await s.j(`/api/uploads/${uid}?offset=0`, { method: 'PUT', body: buf.subarray(0, half) }); assert.equal(r.body.received, half); assert.equal(r.body.done, false);
    r = await s.j(`/api/uploads/${uid}?offset=0`, { method: 'PUT', body: buf.subarray(0, 10) }); assert.equal(r.status, 409); assert.equal(r.body.received, half);     // 위치가 다르면 거절하고 어디까지 왔는지 알려 줌
    assert.equal((await s.j(`/api/uploads/${uid}`)).body.received, half);                                                                                         // 새로고침 뒤 이어 올릴 위치 조회
    r = await s.j(`/api/uploads/${uid}?offset=${half}`, { method: 'PUT', body: Buffer.concat([buf.subarray(half), Buffer.alloc(50)]) }); assert.equal(r.status, 413);  // 크기 넘침
    assert.equal((await s.j(`/api/uploads/${uid}`)).body.received, half);
    r = await s.j(`/api/uploads/${uid}?offset=${half}`, { method: 'PUT', body: buf.subarray(half) }); assert.equal(r.body.done, true);
    const v = await s.waitReady(r.body.video.id); assert.equal(v.status, 'ready'); assert.equal(v.title, '이어 올린 영상'); assert.equal(v.visibility, 'unlisted');
    assert.equal((await s.j(`/api/uploads/${uid}`)).status, 404);
    assert.equal((await s.j('/api/uploads', J({ filename: 'x.exe', size: 10 }))).status, 400);
    // 목록에 숨김(링크로만): 목록·검색엔 없고 주소로는 열림
    assert.equal((await s.j('/api/videos')).body.videos.length, 0); assert.equal((await s.j('/api/videos?all=1')).body.videos.length, 1); assert.equal((await s.j('/api/videos/' + v.id)).status, 200);
    // 취소
    const c = await s.j('/api/uploads', J({ filename: 'c.mp4', size: 100 })); assert.equal((await s.j('/api/uploads/' + c.body.uploadId, { method: 'DELETE' })).status, 200);
    assert.equal(fs.readdirSync(path.join(s.dataDir, 'incoming')).length, 0);
  } finally { await s.stop(); }
});

test('재생 목록, 인기, 태그, 답글, 싫어요·신고, 관리, 분류 편집', async () => {
  const s = await start({ ffmpeg: 'no-such-ffmpeg-binary' });
  try {
    const mk = async (title, extra = {}) => (await s.waitReady((await s.j('/api/upload?' + new URLSearchParams({ filename: 'a.mp4', title, ...extra }), { method: 'PUT', body: Buffer.alloc(1000 + title.length * 500, 1) })).body.video.id)).id;
    const a = await mk('가', { tags: '공통, 하나', cat: '교육' }), b = await mk('나나', { tags: '공통', cat: '안내' }), c = await mk('다다다', { cat: '교육' });
    // 태그·인기(이번 주 조회)
    assert.deepEqual((await s.j('/api/videos?tag=' + encodeURIComponent('공통'))).body.videos.map((v) => v.title).sort(), ['가', '나나']);
    for (let i = 0; i < 3; i++) await s.j(`/api/videos/${b}/view`, { method: 'POST' }); await s.j(`/api/videos/${c}/view`, { method: 'POST' });
    const wk = (await s.j('/api/videos?sort=week')).body.videos; assert.deepEqual(wk.map((v) => v.title), ['나나', '다다다', '가']); assert.equal(wk[0].weekViews, 3);
    assert.deepEqual((await s.j(`/api/videos?ids=${c},${a},000000000000`)).body.videos.map((v) => v.title), ['다다다', '가']);      // 시청 기록·나중에 볼 영상용
    // 재생 목록
    const pl = (await s.j('/api/playlists', J({ title: '신입 교육', desc: '순서대로' }))).body.playlist;
    for (const id of [a, b, c, a]) await s.j(`/api/playlists/${pl.id}/videos`, J({ video: id }));
    let g = (await s.j('/api/playlists/' + pl.id)).body.playlist; assert.deepEqual(g.videos.map((v) => v.id), [a, b, c]);
    g = (await s.j('/api/playlists/' + pl.id, { ...J({ videos: [c, a] }), method: 'PATCH' })).body.playlist; assert.deepEqual(g.videos.map((v) => v.id), [c, a, b]);   // 순서 바꾸기
    assert.equal((await s.j(`/api/playlists/${pl.id}/videos/${a}`, { method: 'DELETE' })).body.playlist.count, 2);
    assert.deepEqual((await s.j('/api/videos/' + b)).body.playlists, [pl.id]);
    assert.equal((await s.j('/api/playlists', J({ title: ' ' }))).status, 400);
    // 답글·댓글 좋아요
    const c1 = (await s.j(`/api/videos/${a}/comments`, J({ text: '질문' }))).body.comment, c2 = (await s.j(`/api/videos/${a}/comments`, J({ text: '답', parent: c1.id }))).body.comment;
    assert.equal(c2.parent, c1.id); assert.equal((await s.j(`/api/videos/${a}/comments`, J({ text: '답의 답', parent: c2.id }))).body.comment.parent, null);   // 한 단계만
    assert.equal((await s.j(`/api/videos/${a}/comments/${c1.id}/like`, J({}))).body.likes, 1); assert.equal((await s.j(`/api/videos/${a}/comments/${c1.id}/like`, J({ undo: true }))).body.likes, 0);
    await s.j(`/api/videos/${a}/comments/${c1.id}`, { method: 'DELETE' }); assert.equal((await s.j('/api/videos/' + a)).body.comments.length, 1, '댓글을 지우면 답글도 지움');
    // 좋아요 취소·싫어요·신고·숨김
    await s.j(`/api/videos/${a}/like`, J({})); assert.equal((await s.j(`/api/videos/${a}/like`, J({ undo: true }))).body.likes, 0);
    assert.equal((await s.j(`/api/videos/${a}/dislike`, J({}))).body.dislikes, 1);
    assert.equal((await s.j(`/api/videos/${a}/report`, J({ reason: '' }))).status, 400); await s.j(`/api/videos/${a}/report`, J({ reason: '내용이 틀려요' }));
    assert.equal((await s.j('/api/videos?all=1&sort=reports')).body.videos[0].id, a); assert.equal((await s.j(`/api/videos/${a}/reports`)).body.reports[0].reason, '내용이 틀려요');
    await s.j('/api/videos/' + a, { ...J({ hidden: true }), method: 'PATCH' }); assert.equal((await s.j('/api/videos')).body.videos.length, 2); assert.equal((await s.j('/api/playlists/' + pl.id)).body.playlist.count, 2);
    await s.j('/api/videos/' + a, { ...J({ hidden: false, clearReports: true }), method: 'PATCH' }); assert.equal((await s.j('/api/videos/' + a)).body.video.reports, 0);
    // 관리: 용량순, 일괄 삭제
    assert.deepEqual((await s.j('/api/videos?all=1&sort=size')).body.videos.map((v) => v.title), ['다다다', '나나', '가']);
    assert.equal((await s.j('/api/admin/delete', J({ ids: [b, '000000000000'] }))).body.deleted, 1); assert.equal((await s.j('/api/playlists/' + pl.id)).body.playlist.count, 1);
    // 분류 편집: 이름 바꾸기, 없앤 분류의 영상은 마지막 분류로
    const cats = await s.j('/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: ['강의', '기타'], rename: { 교육: '강의' } }) });
    assert.deepEqual(cats.body.categories, ['강의', '기타']); assert.equal((await s.j('/api/videos/' + c)).body.video.category, '강의');
    assert.equal((await s.j('/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: [] }) })).status, 400);
    assert.deepEqual((await s.j('/api/meta')).body.categories, ['강의', '기타']);
    assert.equal((await s.j('/api/playlists/' + pl.id, { method: 'DELETE' })).status, 200); assert.equal((await s.j('/api/playlists')).body.playlists.length, 0);
  } finally { await s.stop(); }
});

/* ---------- 핵심 뽑기 ---------- */
const http = require('node:http');
const { parseSubs, cleanPoints } = require('../server/insight.cjs');
// 가짜 음성 인식: 정해진 대본을 돌려준다.
function fakeStt(dir, segs) {
  const f = path.join(dir, 'fake-stt.cjs');
  fs.writeFileSync(f, `const a = process.argv.slice(2); if (a[0] === '--check') process.exit(0); require('fs').writeFileSync(a[1], ${JSON.stringify(JSON.stringify({ segments: segs }))});`);
  return [process.execPath, f];
}
// 가짜 AI 서버: 받은 요청을 기록하고 정해진 답을 준다.
async function fakeLlm(answer) {
  const calls = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { const body = JSON.parse(b); calls.push(body);
    const out = typeof answer === 'function' ? answer(body, calls.length) : answer;
    if (out === null) { res.writeHead(500); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: out } }] })); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/v1`, calls, close: () => new Promise((r) => srv.close(r)) };
}
const SEGS = [{ start: 0, end: 0.6, text: '안녕하세요 반갑습니다' }, { start: 0.6, end: 1.4, text: '밸브를 잠그기 전에 압력을 확인합니다' }, { start: 1.4, end: 2.0, text: '볼트는 대각선 순서로 조입니다' }, { start: 2.0, end: 2.8, text: '이상으로 마치겠습니다' }];
const waitInsight = async (s, id, not = ['queued', 'working']) => { for (let i = 0; i < 100; i++) { const r = await s.j(`/api/videos/${id}/insight`); if (r.status === 200 && !not.includes(r.body.insight.status) && s.app.insight.idle()) return r.body.insight; await new Promise((x) => setTimeout(x, 100)); } throw new Error('핵심 뽑기가 끝나지 않음'); };
const putVideo = async (s, title = '밸브 교체') => { const up = await s.j('/api/upload?' + new URLSearchParams({ filename: 'a.mp4', title }), { method: 'PUT', body: fs.readFileSync(sample(s.dataDir)) }); await s.waitReady(up.body.video.id); return up.body.video.id; };

test('자막 파일 읽기와 구간 다듬기', () => {
  const segs = parseSubs('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\n첫 줄\n둘째 줄\n\n2\n00:01:02,250 --> 00:01:04,000\n<i>다음</i>\n\n01:05.000 --> 01:06.000\n짧은 형식\n');
  assert.deepEqual(segs, [{ s: 1, e: 3.5, t: '첫 줄 둘째 줄' }, { s: 62.25, e: 64, t: '다음' }, { s: 65, e: 66, t: '짧은 형식' }]);
  assert.deepEqual(cleanPoints([{ s: 5, e: 9, t: 'b' }, { s: 1, e: 6, t: 'a' }, { s: 20, e: 20.1, t: '너무 짧음' }, { s: 'x', e: 3 }, { s: 28, e: 99, t: 'c' }], 30),
    [{ s: 1, e: 6, t: 'a' }, { s: 6, e: 9, t: 'b' }, { s: 28, e: 30, t: 'c' }]);
});

test('올리면 자동으로 대본·핵심 구간·요약이 생기고, 고치기·다시 만들기·자막·검색이 된다', { skip: !hasFf }, async () => {
  let picks = 0;
  const llm = await fakeLlm((body) => (/썸네일/.test(body.messages[1].content) ? JSON.stringify({ hooks: ['이 순서 틀리면 샙니다.', '“볼트” 왜 대각선일까', '이 순서 틀리면 샙니다', '압력 0 확인했나요'] }) : null) || '<think>고민</think>```json\n' + JSON.stringify({ summary: `밸브 교체 순서 ${++picks}`, points: [{ from: 1, to: 2, text: '압력을 확인하고 대각선으로 조인다' }, { from: 9, to: 12, text: '없는 줄' }] }) + '\n```');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'));
  const s = await start({ sttCmd: fakeStt(dir, SEGS), llmUrl: llm.url });
  try {
    assert.equal((await s.j('/api/meta')).body.stt, true); assert.equal((await s.j('/api/meta')).body.llm, true);
    const id = await putVideo(s);
    let ins = await waitInsight(s, id);
    assert.equal(ins.status, 'ready'); assert.equal(ins.transcript.length, 4); assert.equal(ins.summary, '밸브 교체 순서 1');
    assert.deepEqual(ins.points, [{ s: 0.3, e: 2.3, t: '압력을 확인하고 대각선으로 조인다' }], '줄 번호를 시간으로 바꾸고, 없는 줄은 버린다');
    assert.match(llm.calls[0].messages[1].content, /\[1\] 0:00 밸브를 잠그기 전에 압력을 확인합니다/);
    let v = (await s.j('/api/videos/' + id)).body; assert.equal(v.video.insight, 'ready'); assert.equal(v.video.coreSec, 2); assert.equal(v.video.subs, true); assert.equal(v.insight.points.length, 1);
    // 썸네일 문구: 따옴표·마침표를 떼고 겹치는 것은 하나로
    assert.deepEqual(ins.hooks, ['이 순서 틀리면 샙니다', '볼트 왜 대각선일까', '압력 0 확인했나요']); assert.match(llm.calls[1].messages[1].content, /거짓/);
    assert.deepEqual((await s.j(`/api/videos/${id}/hooks`, { method: 'POST', body: '{}' })).body.hooks.length, 3); llm.calls.pop();
    // 자동 썸네일은 한 번만, 사람이 고른 썸네일은 덮어쓰지 않는다
    const jpg = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', '-f', 'mjpeg', '-'], { maxBuffer: 1 << 24 }).stdout, img = { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpg };
    let th = (await s.j(`/api/videos/${id}/thumb?auto=1`, img)).body; assert.equal(th.video.autoThumb, true); assert.equal(th.video.customThumb, false);
    assert.equal((await s.j(`/api/videos/${id}/thumb?auto=1`, img)).body.skipped, true);
    // 말한 내용으로 검색
    assert.equal((await s.j('/api/videos?q=' + encodeURIComponent('대각선'))).body.videos.length, 1);
    assert.equal((await s.j('/api/videos?q=' + encodeURIComponent('없는말'))).body.videos.length, 0);
    // 자막
    const vtt = await (await fetch(`${s.base}/subs/${id}.vtt`)).text(); assert.match(vtt, /^WEBVTT\n\n00:00:00.000 --> 00:00:00.600\n안녕하세요 반갑습니다/);
    // 사람이 고침 → 다시 돌려도(강제가 아니면) 그대로
    const ed = await s.j(`/api/videos/${id}/insight`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: '내가 쓴 요약', points: [{ s: 1.4, e: 2.0, t: '볼트 순서' }, { s: 0.5, e: 1.2, t: '압력 확인' }] }) });
    assert.equal(ed.body.insight.edited, true); assert.deepEqual(ed.body.insight.points.map((p) => p.t), ['압력 확인', '볼트 순서']);
    s.app.insight.enqueue(id); ins = await waitInsight(s, id); assert.equal(ins.summary, '내가 쓴 요약'); assert.equal(llm.calls.length, 2, '핵심 1번 + 문구 1번');
    // 다시 만들기(강제) → AI 답으로 덮어씀
    assert.equal((await s.j(`/api/videos/${id}/insight`, { method: 'POST', body: '{}' })).status, 200);
    ins = await waitInsight(s, id); assert.equal(ins.summary, '밸브 교체 순서 2'); assert.equal(ins.edited, false);
    // 잘라내면 처음부터 다시 만든다
    await s.j(`/api/videos/${id}/trim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: 0, end: 2.5 }) });
    await s.waitReady(id); ins = await waitInsight(s, id); assert.equal(ins.summary, '밸브 교체 순서 3');
    // 지우면 파일도 사라진다
    await s.j('/api/videos/' + id, { method: 'DELETE' }); await new Promise((r) => setTimeout(r, 100));
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'insight', id + '.json')));
  } finally { await s.stop(); await llm.close(); }
});

test('음성 인식이 없으면: 자막 파일을 올려 핵심을 만들고, AI 가 실패해도 대본은 남는다', { skip: !hasFf }, async () => {
  let fail = false;
  const llm = await fakeLlm(() => (fail ? null : JSON.stringify({ summary: '요약', points: [{ from: 0, to: 0, text: '핵심' }] })));
  const s = await start({ sttCmd: null, llmUrl: llm.url });
  try {
    const id = await putVideo(s);
    let ins = await waitInsight(s, id); assert.equal(ins.status, 'none'); assert.match(ins.note, /음성 인식이 설치되지/);
    assert.equal((await s.j(`/api/videos/${id}/insight`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal((await s.j(`/api/videos/${id}/subs`, { method: 'PUT', body: '자막 아님' })).status, 400);
    const srt = '1\n00:00:00,500 --> 00:00:02,000\n펌프를 끄고 전원을 내립니다. 꼭 확인하세요.\n';
    assert.equal((await s.j(`/api/videos/${id}/subs`, { method: 'PUT', body: srt })).status, 200);
    ins = await waitInsight(s, id); assert.equal(ins.status, 'ready'); assert.deepEqual(ins.points, [{ s: 0.2, e: 2.3, t: '핵심' }]);
    fail = true;
    await s.j(`/api/videos/${id}/insight`, { method: 'POST', body: '{}' }); ins = await waitInsight(s, id);
    assert.equal(ins.status, 'ready'); assert.match(ins.note, /AI 가 핵심을 고르지 못했어요/); assert.equal(ins.transcript.length, 1); assert.equal(ins.points.length, 1, '전에 만든 핵심은 지우지 않는다');
  } finally { await s.stop(); await llm.close(); }
});

test('AI 가 없으면 대본만 만든다. 말소리가 없으면 그렇게 알려 준다', { skip: !hasFf }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'));
  const s = await start({ sttCmd: fakeStt(dir, SEGS), llmUrl: '' });
  const s2 = await start({ sttCmd: fakeStt(fs.mkdtempSync(path.join(os.tmpdir(), 'stt-')), []), llmUrl: '' });
  try {
    let ins = await waitInsight(s, await putVideo(s)); assert.equal(ins.status, 'ready'); assert.equal(ins.transcript.length, 4); assert.equal(ins.points.length, 0); assert.match(ins.note, /대본만/);
    ins = await waitInsight(s2, await putVideo(s2)); assert.equal(ins.status, 'nospeech');
  } finally { await s.stop(); await s2.stop(); }
});

/* ---------- 필요한 부분만 남기기 ---------- */
const { cleanRanges } = require('../server/transcode.cjs');
test('남길 구간 다듬기', () => {
  assert.deepEqual(cleanRanges([{ s: 5, e: 8 }, { s: 1, e: 3 }, { s: 2.5, e: 4 }, { s: 9, e: 9.1 }, { s: 'a', e: 2 }, { s: 20, e: 99 }], 30), [[1, 4], [5, 8], [20, 30]]);
  assert.deepEqual(cleanRanges(null), []);
});
test('올린 영상에서 고른 구간만 남기고, 올릴 때 고른 구간만 저장한다(원본은 지운다)', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const J = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    // 1) 올린 뒤 편집: 0~1초, 2~3초만 남김 → 약 2초
    const id = await putVideo(s);
    assert.equal((await s.j(`/api/videos/${id}/cut`, J({ keep: [] }))).status, 400);
    assert.equal((await s.j(`/api/videos/${id}/cut`, J({ keep: [{ s: 2, e: 3 }, { s: 0, e: 1 }] }))).body.video.status, 'processing');
    let v = await s.waitReady(id);
    assert.equal(v.status, 'ready'); assert.ok(v.duration > 1.7 && v.duration < 2.4, '길이 ' + v.duration); assert.equal(v.low, true);
    const streams = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(s.dataDir, 'media', id + '.mp4')], { encoding: 'utf8' }).stdout;
    assert.match(streams, /video/); assert.match(streams, /audio/);
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'incoming')), [], '원본·임시 파일이 남지 않는다');
    // 2) 올릴 때 구간을 골라 올림(이어 올리기)
    const buf = fs.readFileSync(sample(s.dataDir, 'b.mp4'));
    const init = await s.j('/api/uploads', J({ filename: 'b.mp4', size: buf.length, title: '골라 올림', keep: [{ s: 0.5, e: 1.5 }, { s: 1.2, e: 2 }, { s: 50, e: 60 }] }));
    const done = await s.j(`/api/uploads/${init.body.uploadId}?offset=0&dup=ok`, { method: 'PUT', body: buf });
    assert.equal(done.body.done, true);
    v = await s.waitReady(done.body.video.id);
    assert.equal(v.status, 'ready'); assert.ok(v.duration > 1.2 && v.duration < 1.9, '길이 ' + v.duration);
    assert.equal(s.app.store.video(v.id).keep, undefined);
    // 3) 소리 없는 영상도 편집된다
    const mute = path.join(s.dataDir, 'mute.mp4');
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-c:v', 'libx264', mute]);
    const up = await s.j('/api/upload?' + new URLSearchParams({ filename: 'mute.mp4', title: '소리 없음' }), { method: 'PUT', body: fs.readFileSync(mute) });
    await s.waitReady(up.body.video.id);
    await s.j(`/api/videos/${up.body.video.id}/cut`, J({ keep: [{ s: 0, e: 1 }, { s: 2, e: 3 }] }));
    v = await s.waitReady(up.body.video.id); assert.equal(v.status, 'ready'); assert.ok(v.duration > 1.7 && v.duration < 2.4);
  } finally { await s.stop(); }
});

/* ---------- 가리기 · 소리 정리 ---------- */
const { cleanBoxes } = require('../server/transcode.cjs');
test('가릴 네모 다듬기', () => {
  assert.deepEqual(cleanBoxes([{ x: 0.5, y: 0.5, w: 0.9, h: 0.2 }, { x: 0.1, y: 0.1, w: 0.001, h: 0.5 }, { x: 0, y: 0, w: 0.3, h: 0.3, s: 2, e: 1 }, { x: 0.2, y: 0.2, w: 0.2, h: 0.2, s: 1, e: 2 }], 10),
    [{ x: 0.5, y: 0.5, w: 0.5, h: 0.2, s: 0, e: 11 }, { x: 0.2, y: 0.2, w: 0.2, h: 0.2, s: 1, e: 2 }]);
});
test('가리기: 그린 곳만, 정한 시간에만 모자이크. 소리 정리: 화면은 그대로 두고 소리만. 올릴 때 소리 정리', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const J = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // 한 점의 색(평균)을 뽑는다
  const px = (file, t, x, y) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=8:8:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); return [...r.stdout]; };
  const far = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  try {
    const id = await putVideo(s), file = path.join(s.dataDir, 'media', id + '.mp4');
    // 가는 줄무늬가 있는 곳(모자이크하면 색이 섞여 달라진다)과 건드리지 않을 곳
    const before = { in1: px(file, 1.5, 400, 100), out1: px(file, 1.5, 1000, 600), in0: px(file, 0.3, 1000, 400) };
    const region = (f, t) => spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'crop=256:216:910:250', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 }).stdout;
    const regionBefore = { 1.5: region(file, 1.5), 0.3: region(file, 0.3) };
    assert.equal((await s.j(`/api/videos/${id}/blur`, J({ boxes: [] }))).status, 400);
    assert.equal((await s.j(`/api/videos/${id}/blur`, J({ boxes: [{ x: 0.7, y: 0.33, w: 0.22, h: 0.34, s: 1, e: 2 }] }))).body.video.status, 'processing');
    let v = await s.waitReady(id); assert.equal(v.status, 'ready'); assert.ok(v.duration > 2.5);
    const after = { in1: px(file, 1.5, 400, 100), out1: px(file, 1.5, 1000, 600), in0: px(file, 0.3, 1000, 400) };
    assert.ok(far(before.out1, after.out1) < 40, '가리지 않은 곳은 그대로');
    assert.ok(far(before.in0, after.in0) < 40, '정한 시간 밖에서는 그대로');
    // 가린 곳은 정한 시간(1~2초)에만 화면이 달라진다
    const mad = (a, b) => { let n = 0; for (let k = 0; k < a.length; k++) n += Math.abs(a[k] - b[k]); return n / a.length; };
    const d15 = mad(regionBefore[1.5], region(file, 1.5)), d03 = mad(regionBefore[0.3], region(file, 0.3));
    assert.ok(d15 > 8 && d03 < 3, `가린 곳은 정한 시간에만 달라진다 (안 ${d15.toFixed(1)}, 밖 ${d03.toFixed(1)})`);
    // 소리 정리: 화면 스트림은 그대로(복사), 소리는 남는다
    const vsize = () => spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim();
    const frames = vsize();
    assert.equal((await s.j(`/api/videos/${id}/audio`, J({}))).body.video.status, 'processing');
    v = await s.waitReady(id); assert.equal(v.status, 'ready'); assert.equal(v.audioFixed, true); assert.equal(v.note, ''); assert.equal(vsize(), frames);
    assert.match(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout, /audio/);
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'media')).filter((f) => f.includes('.fix')), []);
    // 올릴 때 소리 정리 + 구간 남기기를 함께
    const buf = fs.readFileSync(sample(s.dataDir, 'c.mp4'));
    const init = await s.j('/api/uploads', J({ filename: 'c.mp4', size: buf.length, title: '정리해서 올림', clean: true, keep: [{ s: 0, e: 1 }, { s: 2, e: 3 }] }));
    const done = await s.j(`/api/uploads/${init.body.uploadId}?offset=0&dup=ok`, { method: 'PUT', body: buf });
    v = await s.waitReady(done.body.video.id); assert.equal(v.status, 'ready'); assert.ok(v.duration > 1.7 && v.duration < 2.4); assert.equal(s.app.store.video(v.id).cleanAudio, undefined);
  } finally { await s.stop(); }
});

/* ---------- 링크 영상 ---------- */
test('링크 영상: 주소만 등록하고 영상은 저장하지 않는다(유튜브, 비메오, 영상 파일 주소, 그 밖의 주소)', async () => {
  const s = await start({ sttCmd: null });
  const J = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const bad of ['', 'youtube', 'javascript:alert(1)', 'ftp://a.b/c.mp4']) assert.equal((await s.j('/api/links', J({ url: bad, title: 'x' }))).status, 400, bad);
    assert.equal((await s.j('/api/links', J({ url: 'https://youtu.be/dQw4w9WgXcQ' }))).status, 400, '제목이 있어야 한다');
    const ids = [];
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ']) {
      const r = await s.j('/api/links', J({ url: u, title: '수돗물 이야기', cat: '안내', tags: '홍보' })); assert.equal(r.status, 200, u);
      assert.deepEqual(r.body.video.link, { type: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }); assert.equal(r.body.video.thumb, true); ids.push(r.body.video.id);
    }
    const link = async (url) => (await s.j('/api/links', J({ url, title: '다른 링크' }))).body.video.link;
    assert.deepEqual(await link('https://vimeo.com/76979871'), { type: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871' });
    assert.deepEqual(await link('https://player.vimeo.com/video/76979871?h=1'), { type: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871' });
    assert.deepEqual(await link('http://files.example.go.kr/edu/safety.MP4?x=1'), { type: 'file', url: 'http://files.example.go.kr/edu/safety.MP4?x=1' });
    assert.deepEqual(await link('https://tv.example.com/v/12345'), { type: 'page', url: 'https://tv.example.com/v/12345' });
    assert.deepEqual(await link('https://www.youtube.com/@channel'), { type: 'page', url: 'https://www.youtube.com/@channel' });
    const v = (await s.j('/api/videos/' + ids[0])).body.video;
    assert.equal(v.kind, 'link'); assert.equal(v.status, 'ready'); assert.equal(v.bytes, 0); assert.equal(v.category, '안내'); assert.deepEqual(v.tags, ['홍보']);
    assert.equal((await s.j('/api/videos?q=' + encodeURIComponent('수돗물'))).body.videos.length, 5);
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'media')), [], '영상 파일은 저장하지 않는다');
    for (const sub of ['trim', 'cut', 'blur', 'audio', 'insight', 'thumb']) assert.equal((await s.j(`/api/videos/${ids[0]}/${sub}`, J({}))).status, 400, sub);
    assert.equal((await s.j(`/api/videos/${ids[0]}/view`, { method: 'POST' })).body.views, 1);
    assert.equal((await s.j(`/api/videos/${ids[0]}/comments`, J({ text: '좋아요' }))).status, 200);
    assert.equal((await s.j('/api/videos/' + ids[0], { method: 'DELETE' })).status, 200);
    assert.equal((await s.j('/api/meta')).body.videos, 9);
  } finally { await s.stop(); }
});

/* ---------- 내려받기 · 시청 그래프 · 필독 · 겹치는 영상 ---------- */
test('내려받기, 시청 그래프, 필독, 겹치는 영상 찾기', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const J = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const id = await putVideo(s, '밸브/교체: 방법');
    // 내려받기: 제목이 파일 이름
    const dl = await fetch(`${s.base}/media/${id}.mp4?download=1`); assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-disposition'), `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent('밸브 교체  방법.mp4')}`); await dl.arrayBuffer();
    assert.equal((await fetch(`${s.base}/media/${id}.mp4`)).headers.get('content-disposition'), null);
    // 시청 그래프: 두 사람이 봄. 한 명은 앞 절반만
    await s.j(`/api/videos/${id}/watch`, J({ first: true, buckets: Array.from({ length: 40 }, (_, i) => i) }));
    await s.j(`/api/videos/${id}/watch`, J({ first: true, buckets: Array.from({ length: 10 }, (_, i) => i) }));
    await s.j(`/api/videos/${id}/watch`, J({ buckets: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 19, 99, -1, 'x'] }));
    const st = (await s.j(`/api/videos/${id}/stats`)).body; assert.equal(st.sessions, 2); assert.equal(st.percent.length, 40); assert.equal(st.percent[0], 100); assert.equal(st.percent[19], 100); assert.equal(st.percent[20], 50); assert.equal(st.percent[39], 50);
    // 필독
    assert.equal((await s.j('/api/videos/' + id, J({ pinned: true }, 'PATCH'))).body.video.pinned, true); assert.equal((await s.j('/api/videos')).body.videos[0].pinned, true);
    assert.equal((await s.j('/api/videos/' + id, J({ pinned: false }, 'PATCH'))).body.video.pinned, false);
    // 겹치는 영상: 같은 파일을 다시 올리면 물어본다. 싫다면 지우고, 좋다면 마무리
    const buf = fs.readFileSync(path.join(s.dataDir, 'in.mp4'));
    let init = await s.j('/api/uploads', J({ filename: 'again.mp4', size: buf.length, title: '또 올림' }));
    let r = await s.j(`/api/uploads/${init.body.uploadId}?offset=0`, { method: 'PUT', body: buf });
    assert.equal(r.body.done, false); assert.deepEqual(r.body.duplicate, { id, title: '밸브/교체: 방법' }); assert.equal(r.body.received, buf.length);
    assert.equal((await s.j('/api/videos')).body.videos.length, 1, '물어보는 동안에는 등록하지 않는다');
    r = await s.j(`/api/uploads/${init.body.uploadId}?offset=${buf.length}&dup=ok`, { method: 'PUT', body: '' });
    assert.equal(r.body.done, true); const id2 = r.body.video.id; await s.waitReady(id2);
    const g = (await s.j('/api/admin/duplicates')).body.groups; assert.equal(g.length, 1); assert.deepEqual(g[0].map((v) => v.id), [id, id2]);
    // 다른 영상은 겹치지 않는다
    const other = fs.readFileSync(sample(s.dataDir, 'other.mp4', '640x360'));
    init = await s.j('/api/uploads', J({ filename: 'other.mp4', size: other.length, title: '다른 영상' }));
    r = await s.j(`/api/uploads/${init.body.uploadId}?offset=0`, { method: 'PUT', body: other }); assert.equal(r.body.done, true); assert.equal(r.body.duplicate, undefined);
    await s.waitReady(r.body.video.id);
  } finally { await s.stop(); }
});

/* ---------- 질문 댓글에 AI 가 답하기 · 실시간 채팅 ---------- */
test('질문 댓글에는 AI 가 영상 내용으로 답글을 달고, 영상에 없는 질문이나 질문이 아닌 댓글에는 달지 않는다', { skip: !hasFf }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'));
  const llm = await fakeLlm((body) => { const c = body.messages[1].content; if (/썸네일/.test(c)) return '{"hooks":[]}';
    if (/^아래는 영상에서 한 말이다/.test(c)) return /질문: 볼트/.test(c) ? '{"answer":"대각선 순서로 조입니다.","line":2}' : '{"answer":null}';
    return JSON.stringify({ summary: '요약', points: [{ from: 1, to: 2, text: '핵심' }] }); });
  const s = await start({ sttCmd: fakeStt(dir, SEGS), llmUrl: llm.url });
  const C = (text) => s.j(`/api/videos/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  let id;
  try {
    id = await putVideo(s); await waitInsight(s, id);
    const q = await C('볼트는 어떤 순서로 조이나요?'); assert.equal(q.body.aiAnswering, true);
    let list; for (let i = 0; i < 50; i++) { list = (await s.j('/api/videos/' + id)).body.comments; if (list.length > 1) break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(list.length, 2); const a = list[1];
    assert.equal(a.ai, true); assert.equal(a.parent, q.body.comment.id); assert.equal(a.text, '대각선 순서로 조입니다.'); assert.equal(a.at, 1, '근거가 된 장면 시간');
    assert.match(llm.calls[llm.calls.length - 1].messages[1].content, /\[2\] 0:01 볼트는 대각선 순서로 조입니다/);
    assert.equal((await C('점심 메뉴가 뭔가요?')).body.aiAnswering, true); assert.equal((await C('잘 봤습니다')).body.aiAnswering, false);
    await new Promise((r) => setTimeout(r, 500)); assert.equal((await s.j('/api/videos/' + id)).body.comments.length, 4, '답이 없으면 답글을 달지 않는다');
  } finally { await s.stop(); await llm.close(); }
});
test('실시간 채팅: 새 글만 가져가고, 지금 보는 사람 수를 센다', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const say = (name, text) => s.j(`/api/videos/${id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }) });
  let id;
  try {
    id = await putVideo(s);
    assert.deepEqual((await s.j(`/api/videos/${id}/chat?after=0&cid=a`)).body, { ok: true, messages: [], last: 0, watching: 1 });
    assert.equal((await say('김주무관', '  ')).status, 400);
    assert.equal((await say('김주무관', '안녕하세요')).body.message.seq, 1); assert.equal((await say('', '질문 있어요')).body.message.name, '익명');
    let r = (await s.j(`/api/videos/${id}/chat?after=0&cid=b`)).body; assert.deepEqual(r.messages.map((x) => x.text), ['안녕하세요', '질문 있어요']); assert.equal(r.last, 2); assert.equal(r.watching, 2);
    r = (await s.j(`/api/videos/${id}/chat?after=2&cid=a`)).body; assert.equal(r.messages.length, 0); assert.equal(r.watching, 2);
    for (let i = 0; i < 305; i++) s.app.store.db.chat[id].push({ seq: 3 + i, name: 'x', text: 't' + i, at: '' }); await say('끝', '마지막');
    assert.equal(s.app.store.db.chat[id].length, 300, '300개까지만 남긴다');
    await s.j('/api/videos/' + id, { method: 'DELETE' }); assert.equal(s.app.store.db.chat[id], undefined);
  } finally { await s.stop(); }
});

/* ---------- 라이브 ---------- */
test('라이브: 조각을 받으면 방송 목록이 생기고, 끝내면 일반 영상이 된다', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const J = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    // 방송하는 브라우저가 보내는 것과 같은 형식(webm)의 8초짜리 영상을 조각내어 보낸다
    const webm = path.join(s.dataDir, 'cam.webm');
    assert.equal(spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', '-shortest', webm]).status, 0);
    const buf = fs.readFileSync(webm);
    assert.equal((await s.j('/api/live', J({}))).status, 400, '제목이 있어야 한다');
    const st = await s.j('/api/live', J({ title: '현장 생중계', cat: '안내' })); assert.equal(st.status, 200);
    const id = st.body.video.id, key = st.body.key; assert.equal(st.body.video.status, 'live'); assert.equal(st.body.video.kind, 'live'); assert.equal(st.body.video.liveKey, undefined, '열쇠는 방송 화면에만 준다');
    assert.equal((await s.j('/api/videos')).body.videos[0].status, 'live');
    assert.equal((await s.j(`/api/live/${id}/chunk?key=wrong`, { method: 'PUT', body: buf.subarray(0, 100) })).status, 403);
    const n = 8, step = Math.ceil(buf.length / n);
    for (let i = 0; i < n; i++) assert.equal((await s.j(`/api/live/${id}/chunk?key=${key}`, { method: 'PUT', body: buf.subarray(i * step, (i + 1) * step) })).status, 200);
    let list = ''; for (let i = 0; i < 100; i++) { const r = await fetch(`${s.base}/live/${id}/live.m3u8`); list = r.status === 200 ? await r.text() : ''; if (/seg00001\.m4s/.test(list)) break; await new Promise((r2) => setTimeout(r2, 150)); }
    assert.match(list, /#EXT-X-MAP:URI="init\.mp4"/); assert.match(list, /seg00000\.m4s/); assert.match(list, /seg00001\.m4s/);
    assert.equal((await fetch(`${s.base}/live/${id}/init.mp4`)).status, 200); assert.ok((await (await fetch(`${s.base}/live/${id}/seg00000.m4s`)).arrayBuffer()).byteLength > 1000);
    assert.equal((await fetch(`${s.base}/live/${id}/../../sunsutv.json`)).status, 404);
    // 채팅은 방송 중에도 된다
    assert.equal((await s.j(`/api/videos/${id}/chat`, J({ name: '시청자', text: '잘 보여요' }))).status, 200);
    // 끝내면 일반 영상으로
    const en = await s.j(`/api/live/${id}/end?key=${key}`, { method: 'POST' }); assert.equal(en.status, 200); assert.equal(en.body.video.status, 'processing');
    const v = await s.waitReady(id); assert.equal(v.status, 'ready'); assert.equal(v.kind, 'file'); assert.equal(v.wasLive, true); assert.ok(v.duration > 6.5 && v.duration < 9.5, '길이 ' + v.duration); assert.equal(v.thumb, true);
    assert.equal((await fetch(`${s.base}/media/${id}.mp4`)).status, 200);
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'live', id)), '방송 조각은 지운다'); assert.equal((await s.j(`/api/live/${id}/chunk?key=${key}`, { method: 'PUT', body: 'x' })).status, 403);
  } finally { await s.stop(); }
});
test('라이브: 방송 화면이 그냥 닫히면 알아서 끝내고, 소리 없는 방송도 된다', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null, liveIdleMs: 1500 });
  try {
    const webm = path.join(s.dataDir, 'mute.webm');
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=5:size=640x360:rate=30', '-c:v', 'libvpx', '-b:v', '600k', webm]);
    const st = await s.j('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '소리 없는 방송', audio: false }) });
    const id = st.body.video.id; await s.j(`/api/live/${id}/chunk?key=${st.body.key}`, { method: 'PUT', body: fs.readFileSync(webm) });
    let v; for (let i = 0; i < 150; i++) { v = (await s.j('/api/videos/' + id)).body.video; if (v.status === 'ready' || v.status === 'failed') break; await new Promise((r) => setTimeout(r, 200)); }
    assert.equal(v.status, 'ready', v.note); assert.ok(v.duration > 3.5 && v.duration < 6.5, '길이 ' + v.duration);
    assert.match(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(s.dataDir, 'media', id + '.mp4')], { encoding: 'utf8' }).stdout, /audio/);
  } finally { await s.stop(); }
});

/* ---------- 출석 · 합치기 · 로고 넣기 ---------- */
test('출석 체크: 켠 영상에서만 받고, 같은 사람은 한 번, 엑셀용 표로 받는다', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const J = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const id = await putVideo(s, '안전 교육');
    assert.equal((await s.j(`/api/videos/${id}/attend`, J({ name: '김철수' }))).status, 400, '꺼져 있으면 받지 않는다');
    assert.equal((await s.j('/api/videos/' + id, J({ attend: true }, 'PATCH'))).body.video.attend, true);
    assert.equal((await s.j(`/api/videos/${id}/attend`, J({ name: ' ', dept: '급수과' }))).status, 400);
    assert.deepEqual((await s.j(`/api/videos/${id}/attend`, J({ name: '김철수', dept: '급수과', seen: 40 }))).body, { ok: true, count: 1, already: false });
    assert.deepEqual((await s.j(`/api/videos/${id}/attend`, J({ name: '김철수', dept: '급수과', seen: 95 }))).body, { ok: true, count: 1, already: true });
    await s.j(`/api/videos/${id}/attend`, J({ name: '이영희 "팀장"', dept: '시설과, 2팀' }));
    const list = (await s.j(`/api/videos/${id}/attendance`)).body.attendance; assert.equal(list.length, 2); assert.equal(list[0].seen, 95, '더 많이 본 값으로');
    assert.equal((await s.j('/api/videos/' + id)).body.video.attendCount, 2);
    const csv = await fetch(`${s.base}/api/videos/${id}/attendance?csv=1`); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.headers.get('content-disposition'), /attachment/);
    const text = Buffer.from(await csv.arrayBuffer()).toString('utf8'); assert.equal(text.charCodeAt(0), 0xFEFF, '엑셀이 한글을 읽도록');
    const rows = text.slice(1).trim().split('\r\n'); assert.equal(rows[0], '"번호","이름","소속","출석 시각","본 비율(%)"'); assert.match(rows[1], /^"1","김철수","급수과","\d{4}-\d\d-\d\d \d\d:\d\d:\d\d","95"$/); assert.match(rows[2], /^"2","이영희 ""팀장""","시설과, 2팀",/);
    await s.j(`/api/videos/${id}/attendance`, { method: 'DELETE' }); assert.equal((await s.j(`/api/videos/${id}/attendance`)).body.attendance.length, 0);
  } finally { await s.stop(); }
});
test('영상 합치기: 크기가 다르거나 소리가 없어도 이어 붙여 새 영상을 만들고, 원하면 원래 영상을 지운다', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const J = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const a = await putVideo(s, '앞 영상');
    const mute = path.join(s.dataDir, 'm.mp4'); spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x480:rate=25', '-c:v', 'libx264', mute]);
    const up = await s.j('/api/upload?' + new URLSearchParams({ filename: 'm.mp4', title: '뒤 영상', tags: '합침' }), { method: 'PUT', body: fs.readFileSync(mute) }); const b = up.body.video.id; await s.waitReady(b);
    assert.equal((await s.j('/api/merge', J({ ids: [a] }))).status, 400); assert.equal((await s.j('/api/merge', J({ ids: [a, '000000000000'] }))).status, 400);
    const mg = await s.j('/api/merge', J({ ids: [a, b], remove: true })); assert.equal(mg.status, 200); assert.equal(mg.body.video.title, '앞 영상 + 뒤 영상'); assert.equal(mg.body.video.status, 'processing');
    const v = await s.waitReady(mg.body.video.id); assert.equal(v.status, 'ready', v.note); assert.ok(v.duration > 4.5 && v.duration < 5.6, '3초 + 2초: ' + v.duration); assert.deepEqual(v.tags, ['합침']);
    assert.equal(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(s.dataDir, 'media', v.id + '.mp4')], { encoding: 'utf8' }).stdout.trim(), '1280,720', '첫 영상 크기에 맞춘다');
    await new Promise((r) => setTimeout(r, 200)); assert.deepEqual((await s.j('/api/videos?all=1')).body.videos.map((x) => x.id), [v.id], '원래 영상은 지운다');
    assert.deepEqual(fs.readdirSync(path.join(s.dataDir, 'incoming')), []);
  } finally { await s.stop(); }
});
test('로고 넣기: 켜 두면 새 영상에 자동으로, 이미 올린 영상에는 버튼으로 한 번만', { skip: !hasFf }, async () => {
  const s = await start({ sttCmd: null });
  const J = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const corner = (file) => [...spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'crop=120:60:1120:630,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout];
  try {
    const old = await putVideo(s, '로고 전'), oldFile = path.join(s.dataDir, 'media', old + '.mp4'), before = corner(oldFile);
    assert.equal((await s.j('/api/watermark', J({ on: true }, 'PATCH'))).status, 400, '그림이 없으면 켤 수 없다'); assert.equal((await s.j(`/api/videos/${old}/mark`, J({}))).status, 400);
    const png = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=400x200', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 1 << 24 }).stdout;
    assert.equal((await s.j('/api/watermark', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 400);
    const w = (await s.j('/api/watermark?pos=br&opacity=1&on=1', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png })).body.watermark; assert.equal(w.on, true); assert.equal(w.has, true); assert.equal(w.pos, 'br');
    assert.equal((await fetch(s.base + '/watermark.png')).status, 200); assert.equal((await s.j('/api/meta')).body.watermark.on, true);
    // 이미 올린 영상: 버튼으로
    assert.equal((await s.j(`/api/videos/${old}/mark`, J({}))).body.video.status, 'processing'); let v = await s.waitReady(old); assert.equal(v.marked, true); assert.equal(v.note, '');
    const after = corner(oldFile); assert.ok(after[0] > 180 && after[1] < 90 && after[2] < 90, '오른쪽 아래에 빨간 로고: ' + after); assert.ok(Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]) > 60);
    assert.equal((await s.j(`/api/videos/${old}/mark`, J({}))).status, 400, '두 번 넣지 않는다');
    // 새 영상: 자동으로
    const neu = await s.j('/api/upload?' + new URLSearchParams({ filename: 'n.mp4', title: '로고 후' }), { method: 'PUT', body: fs.readFileSync(sample(s.dataDir, 'n.mp4', '1280x720')) }); v = await s.waitReady(neu.body.video.id);
    assert.equal(v.marked, true); const c2 = corner(path.join(s.dataDir, 'media', v.id + '.mp4')); assert.ok(c2[0] > 180 && c2[1] < 90, '새 영상에도 로고: ' + c2);
    // 끄면 넣지 않는다
    await s.j('/api/watermark', J({ on: false }, 'PATCH')); const off = await s.j('/api/upload?' + new URLSearchParams({ filename: 'o.mp4', title: '로고 없음' }), { method: 'PUT', body: fs.readFileSync(sample(s.dataDir, 'o.mp4', '640x360')) });
    assert.equal((await s.waitReady(off.body.video.id)).marked, false);
  } finally { await s.stop(); }
});
