#!/usr/bin/env bash
# 순수TV 음성 인식 설치(서버에서 한 번). 모듈 폴더 안에 stt-venv 를 만들고 faster-whisper 와 모델을 받는다.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
[ -d stt-venv ] || "$PY" -m venv stt-venv
./stt-venv/bin/pip install --upgrade pip >/dev/null
./stt-venv/bin/pip install faster-whisper
MODEL="${SUNSUTV_STT_MODEL:-small}"
./stt-venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('$MODEL', device='cpu', compute_type='int8'); print('음성 인식 준비 완료 (모델: $MODEL)')"
command -v ffmpeg >/dev/null || echo "주의: ffmpeg 가 없어요. sudo apt install ffmpeg 로 설치하세요."
