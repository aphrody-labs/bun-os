# tty1 starts the graphical session unless the kernel command line has aphrody.session=none.
if ((^tty | str trim) == "/dev/tty1") and not ("WAYLAND_DISPLAY" in $env) and not (open /proc/cmdline | str contains "aphrody.session=none") {
  exec /usr/local/bin/aphrody-session
}
