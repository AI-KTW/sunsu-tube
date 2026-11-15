const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 작은 JSON 저장소. 영상 수천 개까지는 이걸로 충분하다(파일 하나, 임시 파일에 쓰고 바꿔치기).
// 자동 백업: 하루에 한 번 backup/ 에 그날의 사본을 남기고(최근 14일), 기록 파일이 깨져 있으면 가장 최근 백업으로 되살린다.
const KEEP_DAYS = 14;
function createStore(dataDir, defaults = {}, log = console.log) {
  const file = path.join(dataDir, 'sunsutv.json');
  for (const d of ['', 'incoming', 'media', 'thumbs', 'insight', 'backup']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  const backupDir = path.join(dataDir, 'backup'), backups = () => fs.readdirSync(backupDir).filter((f) => /^sunsutv-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
  let db = { videos: [], comments: [], playlists: [], uploads: [], categories: null, chat: {} };
  let restoredFrom = null;
  if (fs.existsSync(file)) {
    try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch {   // 기록 파일이 깨졌다 → 깨진 파일은 따로 남겨 두고, 읽을 수 있는 가장 최근 백업으로 되살린다
      fs.copyFileSync(file, file + '.broken-' + Date.now());
      for (const f of backups().reverse()) { try { db = { ...db, ...JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf8')) }; restoredFrom = f; break; } catch { } }
      log(restoredFrom ? `[순수TV] 기록 파일이 깨져 있어 백업(${restoredFrom})으로 되살렸어요.` : '[순수TV] 기록 파일이 깨져 있고 쓸 수 있는 백업이 없어 빈 상태로 시작해요. 깨진 파일은 .broken 으로 남겨 두었어요.');
    }
  }
  if (!Array.isArray(db.categories) || !db.categories.length) db.categories = [...(defaults.categories || ['기타'])];
  let timer = null;
  // 그날의 첫 저장 전에, 지금까지의 기록을 그날 날짜로 한 벌 남긴다
  function backup(force) {
    const name = `sunsutv-${new Date().toISOString().slice(0, 10)}.json`, dest = path.join(backupDir, name);
    if (!fs.existsSync(file) || (fs.existsSync(dest) && !force)) return null;
    try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }   // 깨진 것은 백업하지 않는다
    fs.copyFileSync(file, dest); for (const old of backups().slice(0, -KEEP_DAYS)) fs.unlink(path.join(backupDir, old), () => { });
    return name;
  }
  function flush() {
    timer = null;
    try { backup(false); } catch (e) { log('[순수TV] 백업을 남기지 못했어요: ' + e.message); }
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, file);
  }
  const save = () => { if (!timer) timer = setTimeout(flush, 50); };
  const newId = () => crypto.randomBytes(6).toString('hex');
  return {
    db, save, flush: () => { if (timer) { clearTimeout(timer); flush(); } }, newId, file, restoredFrom,
    backupNow: () => { if (timer) { clearTimeout(timer); flush(); } return backup(true); },
    backupList: () => backups().reverse().map((f) => ({ name: f, date: f.slice(8, 18), bytes: fs.statSync(path.join(backupDir, f)).size })),
    backupPath: (name) => (/^sunsutv-\d{4}-\d\d-\d\d\.json$/.test(name) ? path.join(backupDir, name) : null),
    video: (id) => db.videos.find((v) => v.id === id),
    playlist: (id) => db.playlists.find((p) => p.id === id),
    commentsOf: (id) => db.comments.filter((c) => c.video === id),
    paths: {
      incoming: (id, ext) => path.join(dataDir, 'incoming', id + ext),
      media: (id) => path.join(dataDir, 'media', id + '.mp4'),
      mediaLow: (id) => path.join(dataDir, 'media', id + '_360.mp4'),
      thumb: (id) => path.join(dataDir, 'thumbs', id + '.jpg'),
      insight: (id) => path.join(dataDir, 'insight', id + '.json'),
      watermark: () => path.join(dataDir, 'watermark.png')
    }
  };
}

module.exports = { createStore };
