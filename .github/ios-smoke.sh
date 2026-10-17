#!/usr/bin/env bash
# Boots an iPhone simulator, opens Browsery's main screens with launch arguments and saves screenshots plus any crash report.
set -x
OUT=qa-out; mkdir -p $OUT
APP=Browsery-ios/build/Build/Products/Debug-iphonesimulator/Browsery.app
BID=app.browsery.ios
DEV=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
phones=[x for k,v in sorted(d.items(), reverse=True) if "iOS" in k for x in v if x["name"].startswith("iPhone")]
pick=[x for x in phones if x["name"] in ("iPhone 16 Pro","iPhone 16")] or phones
print(pick[0]["udid"])')
xcrun simctl list devices available | grep "$DEV" > $OUT/device.txt
xcrun simctl boot "$DEV"
xcrun simctl bootstatus "$DEV" -b
xcrun simctl status_bar "$DEV" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 || true
xcrun simctl install "$DEV" "$APP"

run() { # name wait args...
  local name=$1 wait=$2; shift 2
  xcrun simctl terminate "$DEV" $BID 2>/dev/null
  xcrun simctl launch "$DEV" $BID -freshSession "$@" > "$OUT/$name.launch.txt" 2>&1
  sleep "$wait"
  xcrun simctl io "$DEV" screenshot "$OUT/$name.png"
  if xcrun simctl spawn "$DEV" launchctl list | grep -q "$BID"; then echo "$name: running" >> $OUT/status.txt; else echo "$name: NOT RUNNING" >> $OUT/status.txt; fi
}

PAGE="https://en.m.wikipedia.org/wiki/Saturn"
run 01-newtab 7
run 02-page 14 -smokeURL "$PAGE"
run 03-menu 12 -smokeURL "$PAGE" -smokePanel menu
run 04-tabs 12 -smokeURL "$PAGE" -smokePanel tabs
run 05-groq 9 -smokePanel groq
run 06-settings 10 -smokePanel settings
run 07-chill-newtab 7 -chill YES
run 08-chill-page 14 -chill YES -smokeURL "$PAGE"
xcrun simctl ui "$DEV" appearance light
run 09-chill-light 7 -chill YES
run 10-chill-light-menu 10 -chill YES -smokeURL "$PAGE" -smokePanel menu

cat $OUT/status.txt
mkdir -p $OUT/crashes
cp ~/Library/Logs/DiagnosticReports/Browsery* $OUT/crashes/ 2>/dev/null || true
ls $OUT/crashes
exit 0
