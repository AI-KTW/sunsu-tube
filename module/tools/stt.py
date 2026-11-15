"""순수튜브 음성 인식: 소리 파일을 글(시간 포함)로 바꾼다. faster-whisper 를 쓴다(무료, 서버 안에서만 동작).

  python stt.py --check            설치됐는지 확인(됐으면 종료 코드 0)
  python stt.py in.wav out.json    out.json = {"segments":[{"start":0.0,"end":2.1,"text":"..."}]}

환경변수: SUNSUTUBE_STT_MODEL(기본 small), SUNSUTUBE_STT_DEVICE(기본 cpu, GPU 는 cuda), SUNSUTUBE_STT_LANG(기본 ko)
"""
import json
import os
import sys


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--check":
        import faster_whisper  # noqa: F401
        return 0
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    from faster_whisper import WhisperModel

    device = os.environ.get("SUNSUTUBE_STT_DEVICE", "cpu")
    model = WhisperModel(os.environ.get("SUNSUTUBE_STT_MODEL", "small"), device=device,
                         compute_type="float16" if device == "cuda" else "int8")
    lang = os.environ.get("SUNSUTUBE_STT_LANG", "ko") or None
    # 16kHz 모노 wav 를 직접 읽는다(영상 해석 라이브러리 버전 문제를 피한다).
    import wave
    import numpy as np
    with wave.open(sys.argv[1], "rb") as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = model.transcribe(audio, language=lang, vad_filter=True, beam_size=5)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump({"segments": out}, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
