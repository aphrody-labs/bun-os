. /tests/lib.sh
check adb-version "Android Debug Bridge" adb version
check apk-detected "android-apk" bunos detect /fixtures/clipboardeditor.apk
check dispatch-no-target-honest "no Android target" sh -c 'unset ANDROID_SERIAL; bunos run /fixtures/clipboardeditor.apk 2>&1; test $? -eq 3'
if [ -n "${REDROID_HOST:-}" ]; then
  adb connect "$REDROID_HOST:5555" >/dev/null
  for i in $(seq 1 90); do [ "$(adb -s $REDROID_HOST:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; sleep 2; done
  export ANDROID_SERIAL=$REDROID_HOST:5555
  check android-booted "1" adb shell getprop sys.boot_completed
  check dispatch-apk-install "Success" bunos run /fixtures/clipboardeditor.apk
  check package-installed "com.trianguloy.clipboardeditor" adb shell pm list packages -3
else
  echo "SKIP redroid: REDROID_HOST not set (needs binder_linux on the Docker host)"
fi
finish
