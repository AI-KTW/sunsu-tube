const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSunsuTubeApp } = require('../server/app.cjs');

const hasFf = spawnSync('ffmpeg', ['-version']).status === 0;
function sample(dir, name = 'in.mp4', size = '1920x1080') {
  const f = path.join(dir, name);
  const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `testsrc=duration=3:size=${size}:rate=15`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-crf', '10', '-c:a', 'aac', '-shortest', f]);
  assert.equal(r.status, 0, 'ffmpeg 로 시험 영상을 만들지 못함');
  return f;
}
async function start(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunsutube-'));
  const app = createSunsuTubeApp({ dataDir, port: 0, log: () => { }, ...opts });
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
    s.app.store.flush(); assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'sunsutube.json'), 'utf8')).videos[0].title, '제수밸브 교체(개정)');
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
    assert.equal((await fetch(s.base + '/media/..%2F..%2Fsunsutube.json')).status, 404);
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
    assert.equal(dims(path.join(s.dataDir, 'thumbs', id + '.jpg')), '480,360');
    assert.equal((await fetch(`${s.base}/api/videos/${id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: 'not an image' })).status, 400);
    assert.equal((await fetch(`${s.base}/api/videos/${id}/thumb`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 400);
    // 잘라내기 1~2초
    assert.equal((await s.j(`/api/videos/${id}/trim`, J({ start: 2, end: 1 }))).status, 400);
    const tr = await s.j(`/api/videos/${id}/trim`, J({ start: 1, end: 2 })); assert.equal(tr.body.video.status, 'processing');
    v = await s.waitReady(id); assert.equal(v.status, 'ready'); assert.ok(v.duration > 0.8 && v.duration < 1.4, '길이 ' + v.duration);
    assert.equal(dims(path.join(s.dataDir, 'thumbs', id + '.jpg')), '480,360', '직접 고른 썸네일은 유지');
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
