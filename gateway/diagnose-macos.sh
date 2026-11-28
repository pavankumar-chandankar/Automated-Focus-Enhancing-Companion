#!/bin/bash
set -euo pipefail
set +x
token="$(/usr/bin/security find-generic-password -a "$USER" -s Oplyra.Gateway.Token -w)"
url="$(/usr/bin/security find-generic-password -a "$USER" -s Oplyra.Gateway.URL -w)"
if [[ ! "$token" =~ ^[0-9a-f]{64}$ || ! "$url" =~ ^https://oplyra-gateway\.[a-z0-9-]+\.workers\.dev/?$ ]]; then
  echo "Invalid gateway credentials in Keychain"; exit 1
fi
url="$(printf '%s' "$url" | sed 's:/$::')"
body='{"model":"openai/gpt-oss-120b","messages":[{"role":"system","content":"Reply with the single word Hello."},{"role":"user","content":"Hi"}],"stream":false,"reasoning_effort":"low","include_reasoning":false,"max_completion_tokens":256,"temperature":0.1}'
echo "Testing actual inference (one request, no private screen or chat data)..."
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
code="$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -q --config - --silent --show-error --max-time 45 --output "$tmp" --write-out '%{http_code}' --header 'Content-Type: application/json' --data "$body" "$url/v1/chat/completions")"
unset token
printf 'HTTP %s\n' "$code"
node -e 'const fs=require("fs");try {const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const ok=d.choices?.[0]?.message?.role==="assistant"&&d.choices[0].finish_reason==="stop"&&typeof d.choices[0].message.content==="string"&&d.choices[0].message.content.trim().length>0;const codes=new Set(["quota_unavailable","provider_connection","provider_auth","provider_request","provider_error","provider_response","not_configured","unauthorized","invalid_request","gateway_unavailable","quota","provider_quota"]);if(ok&&process.argv[2]==="200"){console.log("Inference verified.");}else{console.log("Diagnostic:",codes.has(d.status)?d.status:"unexpected_response");process.exitCode=1;}}catch{console.log("Diagnostic: non_json_response");process.exitCode=1;}' "$tmp" "$code"
