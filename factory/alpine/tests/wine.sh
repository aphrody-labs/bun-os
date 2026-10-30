. /tests/lib.sh
check wine-version "wine-" wine --version
check pe-detect "pe-native" bunos detect /fixtures/hello.exe
check pe-imports-predicted "KERNEL32" bunos detect --json /fixtures/hello.exe
check pe-missing-empty '"missing":[]' bunos detect --json /fixtures/hello.exe
check mingw-hello "hello from bunos" bunos run /fixtures/hello.exe
check 7zip-exe "7-Zip" sh -c 'bunos run /fixtures/7za.exe 2>&1 | head -3'
check pe32-honest "x86 PE" sh -c 'bunos run /fixtures/7zr.exe 2>&1; test $? -eq 3'
check 7zip-roundtrip "Everything is Ok" sh -c 'cd /tmp && echo data > f.txt && wine /fixtures/7za.exe a z.7z f.txt >/dev/null && wine /fixtures/7za.exe t z.7z'
check python-embed "hello from python 3.14" bunos run /fixtures/python-embed/python.exe -- -c 'import sys;print("hello from python", "%d.%d" % sys.version_info[:2])'
check notepad-gui-starts "notepad" sh -c 'xvfb-run -a sh -c "wine notepad & sleep 8; xwininfo -root -tree | grep -i notepad | head -2; wineserver -k; true"'
finish
