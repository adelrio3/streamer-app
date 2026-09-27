#!/bin/bash
# Compendium camera shrinker. Turns finished ProRes camera files ("cam …mov")
# in the recordings folder (and one level of subfolders) into HEVC .mp4 on
# the Mac's hardware encoder, checks the length matches, then moves the
# ProRes original to the Trash. Runs from launchd every few minutes; a file
# still being written (changed in the last 2 minutes) is left alone.
# Usage: shrink.sh "/path/to/recordings" [bitrate, default 16M]
set -u
DIR="${1:-}"
RATE="${2:-16M}"
LOG="$HOME/Library/Logs/compendium-shrink.log"
[ -d "$DIR" ] || { echo "$(date '+%F %T') no such folder: $DIR" >> "$LOG"; exit 1; }
FFMPEG="$(command -v ffmpeg || ls /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg 2>/dev/null | head -1)"
FFPROBE="$(command -v ffprobe || ls /opt/homebrew/bin/ffprobe /usr/local/bin/ffprobe 2>/dev/null | head -1)"
[ -x "$FFMPEG" ] && [ -x "$FFPROBE" ] || { echo "$(date '+%F %T') ffmpeg not found (brew install ffmpeg)" >> "$LOG"; exit 1; }
# Nothing happens on its own: the job only works while the "go" flag is in
# the folder (Compendium writes it from the Recordings page's batch button;
# `shrink.sh DIR RATE now` from Terminal is the same), and never touches a
# file changed in the last 2 minutes. Progress goes to the status file.
FLAG="$DIR/.compendium-shrink-now"
STATUS="$DIR/.compendium-shrink-status"
[ "${3:-}" = "now" ] && touch "$FLAG"
[ -e "$FLAG" ] || exit 0
LOCK="/tmp/compendium-shrink.lock"
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT
find "$DIR" -maxdepth 2 -type f \( -iname 'cam *.mov' -o -iname 'camera *.mov' -o -iname 'face *.mov' \) -mmin +2 -print0 | while IFS= read -r -d '' SRC; do
  [ -e "$FLAG" ] || break
  echo "shrinking $(basename "$SRC") $(date '+%s')" > "$STATUS"
  OUT="${SRC%.*}.mp4"
  [ -e "$OUT" ] && continue
  TMP="${SRC%.*}.shrinking.mp4"
  echo "$(date '+%F %T') shrinking: $SRC" >> "$LOG"
  if "$FFMPEG" -nostdin -hide_banner -loglevel error -y -i "$SRC" -c:v hevc_videotoolbox -b:v "$RATE" -tag:v hvc1 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "$TMP" >> "$LOG" 2>&1; then
    A="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$SRC")"
    B="$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$TMP")"
    if awk -v a="$A" -v b="$B" 'BEGIN { d = a - b; if (d < 0) d = -d; exit !(a > 0 && d < 1.5) }'; then
      mv "$TMP" "$OUT" && touch -r "$SRC" "$OUT"
      osascript -e "tell application \"Finder\" to delete POSIX file \"$SRC\"" >/dev/null 2>&1 || mv "$SRC" "$HOME/.Trash/"
      echo "$(date '+%F %T') done: $OUT ($(du -h "$OUT" | cut -f1)); original moved to the Trash" >> "$LOG"
      echo "done $(basename "$OUT") $(date '+%s')" > "$STATUS"
    else
      echo "$(date '+%F %T') length mismatch ($A vs $B), keeping the original: $SRC" >> "$LOG"
      rm -f "$TMP"
    fi
  else
    echo "$(date '+%F %T') ffmpeg failed on $SRC" >> "$LOG"
    rm -f "$TMP"
  fi
done
# All finished (or stopped): the flag goes, so the next run does nothing.
rm -f "$FLAG"
echo "idle $(date '+%s')" > "$STATUS"
