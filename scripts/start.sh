#!/usr/bin/env bash
# Start the PC render server and expose it to the phone through ngrok.
#   Phone → ngrok (HTTPS) → this computer :3000
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
echo "  Server:  http://localhost:$PORT   (preview: http://localhost:$PORT/preview)"
echo "  Phone:   ${URL:-<ngrok did not start — see /tmp/mamdani-ngrok.log>}"
echo "  Put this in mobile/.env as EXPO_PUBLIC_SERVER_URL=${URL:-…}"
echo
wait $SERVER_PID
