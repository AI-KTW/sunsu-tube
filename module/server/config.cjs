const path = require('node:path');

// 설정. 환경변수로 바꿀 수 있다.
//   SUNSUTUBE_PORT (기본 4396), SUNSUTUBE_HOST (기본 127.0.0.1)
//   SUNSUTUBE_DATA: 영상·썸네일·기록을 두는 폴더(전산실 저장소를 붙였으면 그 경로). 기본 <모듈>/data
//   SUNSUTUBE_MAX_GB: 영상 하나의 최대 크기(GB, 기본 4)
//   SUNSUTUBE_FFMPEG / SUNSUTUBE_FFPROBE: 실행 파일 경로(기본 ffmpeg / ffprobe)
function createConfig(overrides = {}) {
  const moduleRoot = path.resolve(__dirname, '..');
  const dataDir = overrides.dataDir || process.env.SUNSUTUBE_DATA || path.join(moduleRoot, 'data');
  return {
    moduleRoot,
    webRoot: path.join(moduleRoot, 'web'),
    dataDir,
    host: overrides.host || process.env.SUNSUTUBE_HOST || '127.0.0.1',
    port: Number(overrides.port ?? process.env.SUNSUTUBE_PORT ?? 4396),
    maxBytes: Number(overrides.maxGb ?? process.env.SUNSUTUBE_MAX_GB ?? 4) * 1024 ** 3,
    ffmpeg: overrides.ffmpeg || process.env.SUNSUTUBE_FFMPEG || 'ffmpeg',
    ffprobe: overrides.ffprobe || process.env.SUNSUTUBE_FFPROBE || 'ffprobe',
    categories: ['관로·누수', '밸브·계량기', '정수·수질', '펌프·전기', '안전', '민원·행정', '교육', '기타'],
    videoExts: ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp']
  };
}

module.exports = { createConfig };
