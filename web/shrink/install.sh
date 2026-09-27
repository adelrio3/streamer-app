#!/bin/bash
# One-time set-up of the Compendium camera shrinker on a Mac:
#   curl -fsSL https://<your app>/shrink/install.sh | bash -s -- "/Users/you/Movies" [bitrate]
# Installs ffmpeg with Homebrew if missing, puts shrink.sh under
# ~/Library/Application Support/Compendium, and loads a launchd agent that
# runs it every 3 minutes. Log: ~/Library/Logs/compendium-shrink.log
set -e
DIR="${1:-}"
RATE="${2:-16M}"
[ -d "$DIR" ] || { echo "Give the recordings folder, e.g.: bash -s -- \"/Users/$USER/Movies\""; exit 1; }
BASE="$(dirname "${BASH_SOURCE[0]:-x}")"
APP="$HOME/Library/Application Support/Compendium"
mkdir -p "$APP" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/ffmpeg ] && [ ! -x /usr/local/bin/ffmpeg ]; then
  command -v brew >/dev/null 2>&1 || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  BREW="$(command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1)"
  "$BREW" install ffmpeg
fi
SRC_URL="${COMPENDIUM_SHRINK_URL:-}"
if [ -n "$SRC_URL" ]; then curl -fsSL "$SRC_URL" -o "$APP/shrink.sh"; else curl -fsSL "https://wowchronicler.netlify.app/shrink/shrink.sh" -o "$APP/shrink.sh"; fi
chmod +x "$APP/shrink.sh"
PLIST="$HOME/Library/LaunchAgents/com.compendium.shrink.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.compendium.shrink</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$APP/shrink.sh</string><string>$DIR</string><string>$RATE</string></array>
  <key>StartInterval</key><integer>180</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/compendium-shrink.err</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. Camera files in $DIR (and its subfolders) are shrunk to HEVC at $RATE within a few minutes of finishing; the ProRes originals go to the Trash. Log: ~/Library/Logs/compendium-shrink.log"
echo "To remove: launchctl unload \"$PLIST\" && rm \"$PLIST\""
