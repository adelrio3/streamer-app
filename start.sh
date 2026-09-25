#!/bin/sh
cd "$(dirname "$0")"
if [ ! -f companion/server.js ]; then
  echo "Chronicler is not unpacked: extract the whole ZIP, then run start.sh from that folder."
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get it from https://nodejs.org"; exit 1; }
exec node companion/server.js --open "$@"
