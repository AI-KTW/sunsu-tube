const path = require('node:path');
const fs = require('node:fs');

// 설정. 환경변수로 바꿀 수 있다.
//   SUNSUTV_PORT (기본 4396), SUNSUTV_HOST (기본 127.0.0.1)
//   SUNSUTV_DATA: 영상·썸네일·기록을 두는 폴더(전산실 저장소를 붙였으면 그 경로). 기본 <모듈>/data
//   SUNSUTV_MAX_GB: 영상 하나의 최대 크기(GB, 기본 4)
//   SUNSUTV_FFMPEG / SUNSUTV_FFPROBE: 실행 파일 경로(기본 ffmpeg / ffprobe)
// 핵심 뽑기(없어도 나머지는 다 된다)
//   SUNSUTV_STT_CMD: 음성 인식 명령. 기본은 <모듈>/stt-venv 의 파이썬(없으면 python3)으로 tools/stt.py 실행. "off" 면 끔
//   SUNSUTV_LLM_URL: AI 서버 주소(OpenAI 호환, 예 http://127.0.0.1:8000/v1). 비우면 대본만 만든다
//   SUNSUTV_LLM_MODEL (기본 Qwen3.6-35B-A3B-FP8), SUNSUTV_LLM_KEY (필요할 때만)
function createConfig(overrides = {}) {
  const moduleRoot = path.resolve(__dirname, '..');
  const dataDir = overrides.dataDir || process.env.SUNSUTV_DATA || path.join(moduleRoot, 'data');
  const venvPy = path.join(moduleRoot, 'stt-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const envStt = process.env.SUNSUTV_STT_CMD;
  const sttCmd = overrides.sttCmd !== undefined ? overrides.sttCmd : envStt === 'off' ? null : envStt ? envStt.trim().split(/\s+/)
    : [fs.existsSync(venvPy) ? venvPy : (process.platform === 'win32' ? 'python' : 'python3'), path.join(moduleRoot, 'tools', 'stt.py')];
  return {
    liveIdleMs: overrides.liveIdleMs || 30000,   // 방송 조각이 이만큼 안 오면 방송을 끝낸다
    sttCmd,
    sttTimeoutMs: 6 * 3600 * 1000,
    llmUrl: overrides.llmUrl ?? process.env.SUNSUTV_LLM_URL ?? '',
    llmModel: overrides.llmModel || process.env.SUNSUTV_LLM_MODEL || 'Qwen3.6-35B-A3B-FP8',
    llmKey: overrides.llmKey || process.env.SUNSUTV_LLM_KEY || '',
    llmTimeoutMs: overrides.llmTimeoutMs || 10 * 60 * 1000,
    moduleRoot,
    webRoot: path.join(moduleRoot, 'web'),
    dataDir,
    host: overrides.host || process.env.SUNSUTV_HOST || '127.0.0.1',
    port: Number(overrides.port ?? process.env.SUNSUTV_PORT ?? 4396),
    maxBytes: Number(overrides.maxGb ?? process.env.SUNSUTV_MAX_GB ?? 4) * 1024 ** 3,
    ffmpeg: overrides.ffmpeg || process.env.SUNSUTV_FFMPEG || 'ffmpeg',
    ffprobe: overrides.ffprobe || process.env.SUNSUTV_FFPROBE || 'ffprobe',
    categories: ['교육', '작업 기록', '회의·발표', '안내', '기타'],
    videoExts: ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp']
  };
}

module.exports = { createConfig };
