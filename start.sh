#!/usr/bin/env bash
# Starts the game server in the background (building it first if the code changed) and opens the game.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
PORT=${PORT:-8080}

if [ -f .lan-racer.pid ] && kill -0 "$(cat .lan-racer.pid)" 2>/dev/null; then
  echo "LAN Racer 3D is already running (pid $(cat .lan-racer.pid))."
else
  if [ ! -x lan-racer ] || [ -n "$(find main.go static -newer lan-racer -print -quit)" ]; then
    echo "Building…"
    go build -o lan-racer .
  fi
  setsid ./lan-racer -addr ":$PORT" > lan-racer.log 2>&1 < /dev/null &
  echo $! > .lan-racer.pid
  for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.1; done
  cat lan-racer.log
fi

xdg-open "http://localhost:$PORT" > /dev/null 2>&1 || true
