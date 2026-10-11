#!/usr/bin/env bash
# Start the PC server (and the city admin panel's back end) and expose it to phones through ngrok.
#   Phone (requests only) → ngrok (HTTPS) → this computer :3000
#   Admin panel: the app in a browser on this computer (npm run web -w adminpanel → http://localhost:8082)
# Anything that arrives through ngrok is never treated as admin: no AI, no decisions.
# The tunnel's URL is written to phone/.env (EXPO_PUBLIC_SERVER_URL), so the phone app's Street View
# and 3D tabs reach this computer. Restart the phone app (npm start -w phone) when the URL changes.
# Requires: ngrok installed and `ngrok config add-authtoken <token>` done once.
# Optional: NGROK_DOMAIN=<your-name>.ngrok-free.dev in server/.env keeps the same URL every start.
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$PATH:$HOME/.local/bin"
PORT="${PORT:-3000}"
NGROK_DOMAIN="${NGROK_DOMAIN:-$(sed -n 's/^NGROK_DOMAIN=//p' server/.env 2>/dev/null | tail -1)}"
NGROK_LOG="${TMPDIR:-/tmp}/mamdani-ngrok.log"

# Set one line of phone/.env (KEY=value), leaving the rest alone. Prints "unchanged" or "updated".
ENV_FILE=phone/.env
set_phone_env() {
  touch "$ENV_FILE"
  if [ "$(sed -n "s/^$1=//p" "$ENV_FILE" | tail -1)" = "$2" ]; then echo unchanged; return; fi
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  echo "$1=$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo updated
}

# Phones on the same Wi-Fi load Street View and the 3D model straight from this computer (much
# faster than through ngrok); the app falls back to ngrok when it can't reach this address.
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
[ -n "$LAN_IP" ] && LAN_CHANGED=$(set_phone_env EXPO_PUBLIC_SERVER_LAN_URL "http://$LAN_IP:$PORT")

npm start --workspace server &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; kill ${NGROK_PID:-} 2>/dev/null' EXIT

local_only() {
  echo
  echo "  $1"
  echo "  Server is only reachable on this network: http://$(ipconfig getifaddr en0 2>/dev/null || hostname):$PORT"
  echo "  Cloud requests and saved previews still work on phones (they go through Supabase)."
  echo
  wait $SERVER_PID
  exit
}

command -v ngrok >/dev/null || local_only "ngrok is not installed."
[ -n "${NGROK_AUTHTOKEN:-}" ] \
  || grep -qs authtoken "$HOME/Library/Application Support/ngrok/ngrok.yml" "$HOME/.config/ngrok/ngrok.yml" \
  || local_only "ngrok has no account token yet. Run once: ngrok config add-authtoken <token>  (https://dashboard.ngrok.com/get-started/your-authtoken)"

ngrok http "$PORT" ${NGROK_DOMAIN:+--url="https://$NGROK_DOMAIN"} --log=stdout > "$NGROK_LOG" &
NGROK_PID=$!
URL=
for _ in $(seq 1 30); do
  URL=$(curl -s localhost:4040/api/tunnels | sed -n 's/.*"public_url":"\(https:[^"]*\)".*/\1/p' | head -1) || true
  [ -n "$URL" ] && break
  kill -0 $NGROK_PID 2>/dev/null || break
  sleep 0.5
done
[ -n "$URL" ] || local_only "ngrok did not start — see $NGROK_LOG"

# Hand the URL to the phone app.
CHANGED=$(set_phone_env EXPO_PUBLIC_SERVER_URL "$URL")
if [ "$CHANGED" = updated ] || [ "${LAN_CHANGED:-}" = updated ]; then CHANGED="updated — restart the phone app: npm start -w phone"; fi

echo
echo "  Server:       http://localhost:$PORT"
echo "  Admin panel:  http://localhost:8082 on this computer (start it with: npm run web -w adminpanel)"
echo "  Phones:       $URL  (requests only; on this Wi-Fi: http://${LAN_IP:-?}:$PORT)"
echo "  phone/.env:   EXPO_PUBLIC_SERVER_URL $CHANGED"
echo
wait $SERVER_PID
