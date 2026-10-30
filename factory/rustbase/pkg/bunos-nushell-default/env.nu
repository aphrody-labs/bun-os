# Bun OS nushell env (login shell is not POSIX: /etc/profile is not sourced, so PATH is set here)
$env.PATH = ($env.PATH | split row (char esep) | prepend [
  "/usr/local/bin"
  ($env.HOME | path join ".bun" "bin")
] | uniq)
$env.BUN_INSTALL = ($env.HOME | path join ".bun")
$env.EDITOR = "hx"
