# SPDX-License-Identifier: Apache-2.0
"""Compositor-neutral client metrics from WAYLAND_DEBUG=client output.

usage: wlbench.py SECONDS WARMUP cmd...   (WAYLAND_DISPLAY selects the compositor under test)

Runs cmd with WAYLAND_DEBUG=client for SECONDS, ignores the first WARMUP seconds, then reports
  commits/s       wl_surface.commit requests per second on the busiest surface (frames the client presented)
  turnaround      median / p95 ms from a commit that carries a frame callback to that callback's `done`
                  (how fast the compositor lets the client draw the next frame)
"""
import os, re, select, statistics, subprocess, sys, time

secs, warm = float(sys.argv[1]), float(sys.argv[2])
env = dict(os.environ, WAYLAND_DEBUG="client")
p = subprocess.Popen(sys.argv[3:], stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, stdin=subprocess.DEVNULL, env=env)
line_re = re.compile(rb"^\[\s*([\d:.]+)\]\s+(?:\{[^}]*\}\s+)?(->)?\s*(\w+)[@#](\d+)\.(\w+)\((.*)\)")
end = time.time() + secs
buf = b""
commits = {}           # surface id -> list of t
pending_cb = {}        # callback id -> request time
last_frame_req = {}    # surface id -> callback id requested since last commit
cb_commit_t = {}       # callback id -> commit time
turn = []
t0 = None
fd = p.stderr.fileno()
while time.time() < end:
    r, _, _ = select.select([fd], [], [], 0.2)
    if not r:
        continue
    chunk = os.read(fd, 1 << 20)
    if not chunk:
        break
    buf += chunk
    *lines, buf = buf.split(b"\n")
    for ln in lines:
        m = line_re.match(ln)
        if not m:
            continue
        ts_raw = m.group(1).decode()
        if ":" in ts_raw:  # libwayland >= 1.24: wall clock HH:MM:SS.micro
            h, mi, se = ts_raw.split(":")
            t = (int(h) * 3600 + int(mi) * 60 + float(se)) * 1000
        else:  # older: milliseconds
            t = float(ts_raw)
        if t0 is None:
            t0 = t
        req, iface, oid, msg, args = m.group(2), m.group(3), int(m.group(4)), m.group(5), m.group(6)
        if req and iface == b"wl_surface" and msg == b"frame":
            nid = re.search(rb"new id wl_callback[@#](\d+)", args)
            if nid:
                last_frame_req[oid] = int(nid.group(1))
        elif req and iface == b"wl_surface" and msg == b"commit":
            if t - t0 >= warm * 1000:
                commits.setdefault(oid, []).append(t)
            cb = last_frame_req.pop(oid, None)
            if cb is not None:
                cb_commit_t[cb] = t
        elif not req and iface == b"wl_callback" and msg == b"done":
            ct = cb_commit_t.pop(oid, None)
            if ct is not None and ct - t0 >= warm * 1000:
                turn.append(t - ct)
p.kill()
if not commits:
    print("no commits observed")
    sys.exit(1)
sid, ts = max(commits.items(), key=lambda kv: len(kv[1]))
span = (ts[-1] - ts[0]) / 1000 if len(ts) > 1 else 0
rate = (len(ts) - 1) / span if span > 0 else 0
if turn:
    turn.sort()
    p95 = turn[int(len(turn) * 0.95) - 1] if len(turn) > 1 else turn[0]
    print(f"commits/s {rate:.1f}  turnaround median {statistics.median(turn):.2f} ms  p95 {p95:.2f} ms  (n={len(turn)})")
else:
    print(f"commits/s {rate:.1f}  turnaround n/a")
