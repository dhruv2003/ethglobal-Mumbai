#!/bin/sh
# First boot only: if the data volume is empty and the image carries a seed, unpack it.
# Later deploys never touch existing data.
set -e
DATA="${ARENA_DATA_DIR:-/data}"
mkdir -p "$DATA"
if [ -f /deploy/seed/data.tgz ] && [ -z "$(ls -A "$DATA" 2>/dev/null | grep -v '^lost+found$')" ]; then
  echo "[seed] empty data volume: unpacking seed into $DATA"
  tar -xzf /deploy/seed/data.tgz -C "$DATA"
fi
exec "$@"
