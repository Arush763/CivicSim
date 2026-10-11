#!/usr/bin/env bash
# Start the PC server (and the city admin panel's back end) and expose it to phones through ngrok.
#   Phone (requests only) → ngrok (HTTPS) → this computer :3000
#   Admin panel: the app in a browser on this computer (npm run web -w mobile → http://localhost:8081)
# Anything that arrives through ngrok is never treated as admin: no AI, no decisions.
# Requires: ngrok installed and `ngrok config add-authtoken <token>` done once.
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
PORT="${PORT:-3000}"

npm start --workspace server &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; kill ${NGROK_PID:-} 2>/dev/null' EXIT

if ! command -v ngrok >/dev/null; then
  echo "ngrok not installed — server is only reachable on this network: http://$(ipconfig getifaddr en0 2>/dev/null || hostname):$PORT"
  wait $SERVER_PID
fi

ngrok http "$PORT" --log=stdout > /tmp/mamdani-ngrok.log &
NGROK_PID=$!
for _ in $(seq 1 20); do
  URL=$(curl -s localhost:4040/api/tunnels | sed -n 's/.*"public_url":"\(https:[^"]*\)".*/\1/p' | head -1)
  [ -n "$URL" ] && break
  sleep 0.5
done
echo
echo "  Server:       http://localhost:$PORT"
echo "  Admin panel:  http://localhost:8081 on this computer (start it with: npm run web -w mobile)"
echo "  Phones:       ${URL:-<ngrok did not start — see /tmp/mamdani-ngrok.log>}  (requests only)"
echo "  Put this in mobile/.env as EXPO_PUBLIC_SERVER_URL=${URL:-…}"
echo
wait $SERVER_PID
