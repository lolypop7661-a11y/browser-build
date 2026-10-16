#!/usr/bin/env bash
# Installs the APK, opens a few screens and saves screenshots plus any crash log.
set -x
OUT=qa-out; mkdir -p $OUT
APK=Browsery-android/app/build/outputs/apk/release/app-release.apk
adb install -r "$APK"
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
# chill mode via settings would need taps; turn it on through prefs-free path: open menu and tap the chill switch row is layout dependent, so skip
adb logcat -d -b crash > $OUT/crash.txt
adb logcat -d | grep -E "AndroidRuntime|FATAL|app.browsery" | tail -200 > $OUT/logcat.txt
adb shell pidof app.browsery.android > $OUT/pid.txt || echo "not running" > $OUT/pid.txt
exit 0
