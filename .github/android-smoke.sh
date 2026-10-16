#!/usr/bin/env bash
# Installs the APK, opens a few screens and saves screenshots plus any crash log.
set -x
OUT=qa-out; mkdir -p $OUT
APK=Browsery-android/app/build/outputs/apk/release/app-release.apk
adb install -r "$APK"
cp "$APK" "$OUT/Browsery-android-1.0.0.apk"
adb logcat -c
shot() { sleep "${2:-4}"; adb exec-out screencap -p > "$OUT/$1.png"; }
size=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); W=${size%x*}; H=${size#*x}
echo "screen $W x $H" > $OUT/info.txt
adb shell am start -n app.browsery.android/.MainActivity
shot 01-newtab 8
# menu (rightmost bottom button)
adb shell input tap $((W*9/10)) $((H-H*45/1000)); shot 02-menu 3
adb shell input keyevent KEYCODE_BACK; sleep 1
# tabs (fourth bottom button)
adb shell input tap $((W*7/10)) $((H-H*45/1000)); shot 03-tabs 3
adb shell input keyevent KEYCODE_BACK; sleep 1
# Hey Groq (center)
adb shell input tap $((W/2)) $((H-H*45/1000)); shot 04-groq 3
adb shell input keyevent KEYCODE_BACK; sleep 1
# open a page from another app
adb shell am start -a android.intent.action.VIEW -d "https://en.m.wikipedia.org/wiki/Saturn" app.browsery.android
shot 05-page 12
adb shell input tap $((W*9/10)) $((H-H*45/1000)); shot 06-page-menu 3
adb shell input keyevent KEYCODE_BACK; sleep 1
# Chill mode: open the menu on the new tab and flip the Chill switch, found by its label
adb shell am start -n app.browsery.android/.MainActivity; sleep 3
adb shell input tap $((W*9/10)) $((H-H*45/1000)); sleep 3
adb shell uiautomator dump /sdcard/ui.xml >/dev/null; adb pull /sdcard/ui.xml $OUT/menu-tree.xml >/dev/null
B=$(grep -o 'content-desc="Chill mode[^"]*"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' $OUT/menu-tree.xml | head -1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]')
echo "chill bounds: $B" >> $OUT/info.txt
if [ -n "$B" ]; then
  set -- $(echo "$B" | tr -d '[]' | tr ',' ' ' | sed 's/\(.*\) \(.*\)/\1 \2/'); X1=${1}; Y1=${2}
  NUMS=$(echo "$B" | grep -o '[0-9]*'); X1=$(echo "$NUMS" | sed -n 1p); Y1=$(echo "$NUMS" | sed -n 2p); X2=$(echo "$NUMS" | sed -n 3p); Y2=$(echo "$NUMS" | sed -n 4p)
  adb shell input tap $(((X1+X2)/2)) $(((Y1+Y2)/2))
fi
shot 07-chill 4
adb shell am start -a android.intent.action.VIEW -d "https://example.com" app.browsery.android
shot 08-chill-page 8
adb logcat -d -b crash > $OUT/crash.txt
adb logcat -d | grep -E "AndroidRuntime|FATAL|app.browsery" | tail -200 > $OUT/logcat.txt
adb shell pidof app.browsery.android > $OUT/pid.txt || echo "not running" > $OUT/pid.txt
exit 0
