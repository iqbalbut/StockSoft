#!/bin/bash
# Creates an "Articulation Coach" launcher app on your Desktop (opens in Chrome/Edge app mode).
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="file://${DIR// /%20}/index.html"
TARGET="$HOME/Desktop/Articulation Coach.command"
if [ -d "/Applications/Google Chrome.app" ]; then
  CMD="open -na \"Google Chrome\" --args --app=\"$URL\""
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  CMD="open -na \"Microsoft Edge\" --args --app=\"$URL\""
else
  echo "Google Chrome or Microsoft Edge is required (Safari does not support live speech recognition)."; exit 1
fi
printf '#!/bin/bash\n%s\n' "$CMD" > "$TARGET"
chmod +x "$TARGET"
echo "Done! Double-click 'Articulation Coach' on your Desktop to start."
