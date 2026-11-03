# SPDX-License-Identifier: Apache-2.0
import os, pty, select, subprocess, sys, time

# usage: ptyrun.py SECONDS cmd...  — runs cmd on a pty (line-buffered stdout), prints what it wrote, then kills it.
secs = float(sys.argv[1])
m, s = pty.openpty()
p = subprocess.Popen(sys.argv[2:], stdout=s, stderr=s, stdin=subprocess.DEVNULL)
os.close(s)
buf = b""
end = time.time() + secs
while time.time() < end:
    r, _, _ = select.select([m], [], [], 0.25)
    if r:
        try:
            buf += os.read(m, 65536)
        except OSError:
            break
p.kill()
sys.stdout.write(buf.decode(errors="replace"))
