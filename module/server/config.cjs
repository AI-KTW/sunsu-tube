const path = require('node:path');
const fs = require('node:fs');

// 설정. 환경변수로 바꿀 수 있다.
//   SUNSUTUBE_PORT (기본 4396), SUNSUTUBE_HOST (기본 127.0.0.1)
//   SUNSUTUBE_DATA: 영상·썸네일·기록을 두는 폴더(전산실 저장소를 붙였으면 그 경로). 기본 <모듈>/data
//   SUNSUTUBE_MAX_GB: 영상 하나의 최대 크기(GB, 기본 4)
//   SUNSUTUBE_FFMPEG / SUNSUTUBE_FFPROBE: 실행 파일 경로(기본 ffmpeg / ffprobe)
// 핵심 뽑기(없어도 나머지는 다 된다)
//   SUNSUTUBE_STT_CMD: 음성 인식 명령. 기본은 <모듈>/stt-venv 의 파이썬(없으면 python3)으로 tools/stt.py 실행. "off" 면 끔
//   SUNSUTUBE_LLM_URL: AI 서버 주소(OpenAI 호환, 예 http://127.0.0.1:8000/v1). 비우면 대본만 만든다
//   SUNSUTUBE_LLM_MODEL (기본 Qwen3.6-35B-A3B-FP8), SUNSUTUBE_LLM_KEY (필요할 때만)
function createConfig(overrides = {}) {
  const moduleRoot = path.resolve(__dirname, '..');
  const dataDir = overrides.dataDir || process.env.SUNSUTUBE_DATA || path.join(moduleRoot, 'data');
  const venvPy = path.join(moduleRoot, 'stt-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const envStt = process.env.SUNSUTUBE_STT_CMD;
  const sttCmd = overrides.sttCmd !== undefined ? overrides.sttCmd : envStt === 'off' ? null : envStt ? envStt.trim().split(/\s+/)
    : [fs.existsSync(venvPy) ? venvPy : (process.platform === 'win32' ? 'python' : 'python3'), path.join(moduleRoot, 'tools', 'stt.py')];
  return {
    sttCmd,
    sttTimeoutMs: 6 * 3600 * 1000,
    llmUrl: overrides.llmUrl ?? process.env.SUNSUTUBE_LLM_URL ?? '',
    llmModel: overrides.llmModel || process.env.SUNSUTUBE_LLM_MODEL || 'Qwen3.6-35B-A3B-FP8',
    llmKey: overrides.llmKey || process.env.SUNSUTUBE_LLM_KEY || '',
    llmTimeoutMs: overrides.llmTimeoutMs || 10 * 60 * 1000,
    moduleRoot,
    webRoot: path.join(moduleRoot, 'web'),
    dataDir,
    host: overrides.host || process.env.SUNSUTUBE_HOST || '127.0.0.1',
    port: Number(overrides.port ?? process.env.SUNSUTUBE_PORT ?? 4396),
    maxBytes: Number(overrides.maxGb ?? process.env.SUNSUTUBE_MAX_GB ?? 4) * 1024 ** 3,
    ffmpeg: overrides.ffmpeg || process.env.SUNSUTUBE_FFMPEG || 'ffmpeg',
    ffprobe: overrides.ffprobe || process.env.SUNSUTUBE_FFPROBE || 'ffprobe',
    categories: ['교육', '작업 기록', '회의·발표', '안내', '기타'],
    videoExts: ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp']
  };
}

module.exports = { createConfig };
