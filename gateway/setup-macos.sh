#!/bin/bash
set -euo pipefail
set +x
cd "$(dirname "$0")"
if [[ "$(uname -s)" != Darwin ]]; then echo "macOS required for this setup"; exit 1; fi
echo "Use a Cloudflare Workers FREE account. Do not select a paid plan."
echo "This installs no paid service. Wrangler is downloaded via npx."
npx --yes wrangler@4 login
npx --yes wrangler@4 deploy
echo "Enter your Groq key only into Wrangler's secret prompt (not this chat)."
npx --yes wrangler@4 secret put GROQ_API_KEY
read -r -p "Paste the deployed https://oplyra-gateway.<your-subdomain>.workers.dev URL: " url
url="$(printf '%s' "$url" | sed 's:/$::')"
if [[ ! "$url" =~ ^https://oplyra-gateway\.[a-z0-9-]+\.workers\.dev$ ]]; then
  echo "Unexpected gateway URL"; exit 1
fi
# Reuse the existing device token on redeployment; otherwise generate 256 random bits.
token="$(/usr/bin/security find-generic-password -a "$USER" -s Oplyra.Gateway.Token -w 2>/dev/null || true)"
if [[ ! "$token" =~ ^[0-9a-f]{64}$ ]]; then token="$(openssl rand -hex 32)"; fi
# Store the generated client token locally. No Groq key is stored here.
# security's -w argument is transiently visible to privileged/local process inspection.
 /usr/bin/security add-generic-password -U -a "$USER" -s Oplyra.Gateway.Token -w "$token"
printf '%s' "$token" | npx --yes wrangler@4 secret put OPLYRA_CLIENT_TOKEN
# Pass the bearer header on stdin, not the curl command line. No redirect.
status="$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl --config - --silent --show-error --max-time 20 --output /dev/null --write-out '%{http_code}' "$url/health")"
if [[ "$status" != 200 ]]; then echo "Gateway health failed (HTTP $status); rerun setup"; exit 1; fi
/usr/bin/security add-generic-password -U -a "$USER" -s Oplyra.Gateway.URL -w "$url"
unset token
echo "Gateway ready. Run bash scripts/run-gateway.sh from companion."
