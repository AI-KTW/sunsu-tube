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
    const q = new URLSearchParams({ filename: '제수밸브 교체.mp4', title: '3가압장 제수밸브 교체', cat: '밸브·계량기', desc: '순서와 주의점', tags: '제수밸브, 150A', author: '시설과 홍길동' });
    const up = await s.j('/api/upload?' + q, { method: 'PUT', body: fs.readFileSync(src) });
    assert.equal(up.status, 200); assert.equal(up.body.video.status, 'processing');
    const id = up.body.video.id;
    const v = await s.waitReady(id);
    assert.equal(v.status, 'ready'); assert.ok(v.duration > 2.5 && v.duration < 3.5); assert.ok(v.thumb); assert.ok(v.bytes > 0 && v.bytes < fs.statSync(src).size, '압축해서 작아져야 함');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(s.dataDir, 'media', id + '.mp4')], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim(), '1280,720');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'incoming', id + '.mp4')), '원본은 지운다');
    // 목록·검색
    assert.equal((await s.j('/api/videos')).body.videos.length, 1);
    assert.equal((await s.j('/api/videos?q=' + encodeURIComponent('제수밸브 홍길동'))).body.videos.length, 1);
    assert.equal((await s.j('/api/videos?q=' + encodeURIComponent('펌프'))).body.videos.length, 0);
    assert.equal((await s.j('/api/videos?cat=' + encodeURIComponent('안전'))).body.videos.length, 0);
    // 재생: 전체와 일부(Range)
    const full = await fetch(`${s.base}/media/${id}.mp4`); assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4'); await full.arrayBuffer();
    const part = await fetch(`${s.base}/media/${id}.mp4`, { headers: { Range: 'bytes=100-199' } }); assert.equal(part.status, 206); assert.equal((await part.arrayBuffer()).byteLength, 100); assert.match(part.headers.get('content-range'), /^bytes 100-199\/\d+$/);
    assert.equal((await fetch(`${s.base}/thumb/${id}.jpg`)).status, 200);
    // 조회·좋아요·댓글
    assert.equal((await s.j(`/api/videos/${id}/view`, { method: 'POST' })).body.views, 1);
    assert.equal((await s.j(`/api/videos/${id}/like`, { method: 'POST' })).body.likes, 1);
    const c = await s.j(`/api/videos/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: '김주무관', text: '여기서 토크 얼마로 조여요?', at: 2 }) });
    assert.equal(c.status, 200); assert.equal(c.body.comment.at, 2);
    assert.equal((await s.j(`/api/videos/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '  ' }) })).status, 400);
    let d = await s.j('/api/videos/' + id); assert.equal(d.body.comments.length, 1); assert.equal(d.body.video.comments, 1);
    // 수정
    const p = await s.j('/api/videos/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '제수밸브 교체(개정)', tags: '밸브 교체' }) });
    assert.equal(p.body.video.title, '제수밸브 교체(개정)'); assert.deepEqual(p.body.video.tags, ['밸브', '교체']);
    // 저장 파일에 남는지(재시작 대비)
    s.app.store.flush(); assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'sunsutube.json'), 'utf8')).videos[0].title, '제수밸브 교체(개정)');
    // 통계
    const meta = (await s.j('/api/meta')).body; assert.equal(meta.videos, 1); assert.ok(meta.usedBytes > 0); assert.ok(meta.categories.includes('안전'));
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
