#!/bin/sh
cd "$(dirname "$0")"
exec node companion/server.js --open "$@"
