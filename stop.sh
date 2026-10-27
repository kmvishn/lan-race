#!/usr/bin/env bash
# Stops the game server started by start.sh.
cd "$(dirname "$(readlink -f "$0")")"

if [ -f .lan-racer.pid ] && kill "$(cat .lan-racer.pid)" 2>/dev/null; then
  echo "LAN Racer 3D stopped."
else
  pids=$(pgrep -x lan-racer || true)
  if [ -n "$pids" ]; then kill $pids && echo "LAN Racer 3D stopped."; else echo "LAN Racer 3D is not running."; fi
fi
rm -f .lan-racer.pid
