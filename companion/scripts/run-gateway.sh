#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
unset GROQ_API_KEY DEEPSEEK_API_KEY
export OPLYRA_PROVIDER=groq
export OPLYRA_GROQ_TRANSPORT=gateway
exec npm run tauri dev
