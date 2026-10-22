#!/bin/bash
# sprite-gen 을 구독 로그인으로만 실행한다: 과금 API 키를 env 에서 빼고 UTF-8 로 출력.
# 사용: SPRITE_GEN=<sprite-gen 실행 파일 경로> bash tools/sprites/gen.sh gen --provider codex ...
if [ -z "$SPRITE_GEN" ]; then
  echo 'SPRITE_GEN 환경변수에 sprite-gen 실행 파일 경로를 넣으세요 (예: <venv>/Scripts/sprite-gen.exe)' >&2
  exit 2
fi
exec env -u OPENAI_API_KEY -u XAI_API_KEY -u ANTHROPIC_API_KEY -u ELEVENLABS_API_KEY \
  -u SPRITE_GEN_CODEX_UNAVAILABLE -u SPRITE_GEN_DEFAULT_PROVIDER \
  PYTHONIOENCODING=utf-8 PYTHONUTF8=1 "$SPRITE_GEN" "$@"
