const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 작은 JSON 저장소. 영상 수천 개까지는 이걸로 충분하다(파일 하나, 임시 파일에 쓰고 바꿔치기).
function createStore(dataDir) {
  const file = path.join(dataDir, 'sunsutube.json');
  for (const d of ['', 'incoming', 'media', 'thumbs']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  let db = { videos: [], comments: [] };
  try { db = { videos: [], comments: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { }
  let timer = null;
  function flush() {
    timer = null;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, file);
  }
  const save = () => { if (!timer) timer = setTimeout(flush, 50); };
  const newId = () => crypto.randomBytes(6).toString('hex');
  return {
    db, save, flush: () => { if (timer) { clearTimeout(timer); flush(); } }, newId,
    video: (id) => db.videos.find((v) => v.id === id),
    commentsOf: (id) => db.comments.filter((c) => c.video === id),
    paths: {
      incoming: (id, ext) => path.join(dataDir, 'incoming', id + ext),
      media: (id) => path.join(dataDir, 'media', id + '.mp4'),
      thumb: (id) => path.join(dataDir, 'thumbs', id + '.jpg')
    }
  };
}

module.exports = { createStore };
