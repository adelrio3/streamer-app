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
# Every run leaves its mark, flag or no flag, so the app can tell "the
# shrinker looked at this folder 2 minutes ago" from "it never ran".
SEEN="$DIR/.compendium-shrink-seen"
echo "seen $(date '+%s')" > "$SEEN" 2>/dev/null
FFMPEG="$(command -v ffmpeg || ls /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg 2>/dev/null | head -1)"
FFPROBE="$(command -v ffprobe || ls /opt/homebrew/bin/ffprobe /usr/local/bin/ffprobe 2>/dev/null | head -1)"
# Nothing happens on its own: the job only works while the "go" flag is in
# the folder (Compendium writes it from the Recordings page's batch button;
# `shrink.sh DIR RATE now` from Terminal is the same), and never touches a
# file changed in the last 2 minutes. Progress goes to the status file.
FLAG="$DIR/.compendium-shrink-now"
STATUS="$DIR/.compendium-shrink-status"
PROGRESS="$DIR/.compendium-shrink-progress" # ffmpeg's own progress (out_time, speed), for the batch page's bar
[ "${3:-}" = "now" ] && touch "$FLAG"
[ -e "$FLAG" ] || exit 0
[ -x "$FFMPEG" ] && [ -x "$FFPROBE" ] || { echo "$(date '+%F %T') ffmpeg not found (brew install ffmpeg)" >> "$LOG"; echo "error ffmpeg not found: run brew install ffmpeg $(date '+%s')" > "$STATUS"; rm -f "$FLAG"; exit 1; }
LOCK="/tmp/compendium-shrink.lock"
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT
# Camera files: "cam …", "camera …" or "face …" (OBS writes the space as an
# underscore when it splits a recording), or any .mov in a cam/camera/face folder.
find "$DIR" -maxdepth 2 -type f \( -iname 'cam[ _]*.mov' -o -iname 'camera[ _]*.mov' -o -iname 'face[ _]*.mov' -o -ipath '*/cam/*.mov' -o -ipath '*/camera/*.mov' -o -ipath '*/face/*.mov' \) -mmin +2 -print0 | sort -z | while IFS= read -r -d '' SRC; do
  [ -e "$FLAG" ] || break
  echo "shrinking $(basename "$SRC") $(date '+%s')" > "$STATUS"
  OUT="${SRC%.*}.mp4"
  [ -e "$OUT" ] && continue
  TMP="${SRC%.*}.shrinking.mp4"
  echo "$(date '+%F %T') shrinking: $SRC" >> "$LOG"
  rm -f "$PROGRESS"
  if "$FFMPEG" -nostdin -hide_banner -loglevel error -y -progress "$PROGRESS" -stats_period 2 -i "$SRC" -c:v hevc_videotoolbox -b:v "$RATE" -tag:v hvc1 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "$TMP" >> "$LOG" 2>&1; then
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
rm -f "$FLAG" "$PROGRESS"
echo "idle $(date '+%s')" > "$STATUS"
