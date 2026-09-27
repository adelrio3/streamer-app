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
  BREW="$(command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1)"
  if [ -z "$BREW" ]; then
    # Homebrew's installer needs a real terminal for the password prompt, which a piped run cannot give it.
    echo "Homebrew is not installed yet. Paste this in Terminal first (it asks for your Mac password, then press Return when told):"
    echo
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    echo
    echo "When it finishes it prints two 'Next steps' lines starting with echo and eval: paste those too. Then run the Compendium command again."
    exit 1
  fi
  echo "Installing ffmpeg with Homebrew (a few minutes)…"
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
echo "Installed. Nothing runs until you press the batch button on Compendium's Recordings page (or run: bash \"$APP/shrink.sh\" \"$DIR\" $RATE now); then the camera files in $DIR (and its subfolders) are shrunk to HEVC at $RATE, one after another, and the ProRes originals go to the Trash. Log: ~/Library/Logs/compendium-shrink.log"
echo "To remove: launchctl unload \"$PLIST\" && rm \"$PLIST\""
