#!/bin/bash
# Smoke test of the installed Rust userland (run inside the Arch container after pacman -U of the built packages).
# Not a conformance suite: it proves the replacement is wired (symlinks, setuid, PAM files, provides) and that
# a few dozen common invocations give the expected output. Prints "smoke: pass=N fail=M total=T" and writes smoke.json.
set -u
pass=0; fail=0; names=()
t() { # t <name> <command...>; the command must succeed
  local name=$1; shift
  if out=$("$@" 2>&1); then pass=$((pass + 1)); else fail=$((fail + 1)); names+=("$name"); echo "FAIL $name: $out" >&2; fi
}
eq() { # eq <name> <expected> <command string>
  local name=$1 want=$2 got
  got=$(bash -c "$3" 2>&1)
  if [ "$got" = "$want" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); names+=("$name"); echo "FAIL $name: want '$want' got '$got'" >&2; fi
}
tmp=$(mktemp -d); cd "$tmp"

eq coreutils-multicall coreutils 'basename "$(readlink -f /usr/bin/ls)"'
eq cat-multicall coreutils 'basename "$(readlink -f /usr/bin/cat)"'
eq version-banner 1 'ls --version | grep -c uutils'
eq sha256 5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03 'echo hello | sha256sum | cut -d" " -f1'
eq sort 'a b' 'printf "b\na\n" | sort | tr "\n" " " | sed "s/ $//"'
eq seq '1 2 3' 'seq 3 | tr "\n" " " | sed "s/ $//"'
eq date-epoch 1970 'date -u -d @0 +%Y'
eq basename b 'basename /a/b.c .c'
eq expr 3 'expr 1 + 2'
eq wc 3 'printf "a\nb\nc\n" | wc -l'
eq head 'x' 'printf "x\ny\n" | head -n1'
eq uname Linux 'uname -s'
eq stat-mode 644 'echo a >f1; chmod 644 f1; stat -c %a f1'
eq ln-symlink f1 'ln -s f1 l1; readlink l1'
eq tr ABC 'echo abc | tr a-z A-Z'
eq printf 'a-1' 'printf "%s-%d" a 1'
eq install-mode 755 'install -Dm755 /dev/null d/x; stat -c %a d/x'
eq mktemp-dir 1 'd=$(mktemp -d); test -d "$d" && echo 1'
eq find-name /usr/bin/ls 'find /usr/bin -maxdepth 1 -name ls -print'
eq find-type 1 'find /usr -maxdepth 0 -type d | wc -l'
eq xargs 'a b' 'printf "a\nb\n" | xargs echo'
printf 'one\ntwo\n' >a; printf 'one\nthree\n' >b; cp a a2
t cmp-identical cmp a a2
eq cmp-differs 1 'cmp -s a b; echo $?'
eq diff-exit 1 'diff a b >/dev/null; echo $?'
eq diff-body 1 'diff a b | grep -c "^> three"'
eq diffutils-link diffutils 'basename "$(readlink -f /usr/bin/diff)"'

# sudo-rs
eq sudo-banner 1 'sudo --version | grep -c sudo-rs'
eq sudo-setuid 4755 'stat -c %a /usr/bin/sudo'
eq su-rs-setuid 4755 'stat -c %a /usr/bin/su-rs'
t visudo-check visudo -c -f /etc/sudoers
t pam-sudo test -f /etc/pam.d/sudo
t pam-sudo-i test -f /etc/pam.d/sudo-i
eq pacman-provides-sudo 1 'pacman -Qi bunos-sudo-rs | grep -c "^Provides.*sudo"'
eq pacman-provides-coreutils 1 'pacman -Qi bunos-uutils-multicall | grep -c "^Provides.*coreutils"'

# util-linux opt-in alternatives (sandboxed destination)
export BUNOS_ALT_DST="$tmp/alt"
bunos-rust-alternatives enable util-linux >/dev/null 2>&1
eq alt-enabled 1 'bunos-rust-alternatives status | grep -c " rust$" | awk "{print (\$1>0)?1:0}"'
bunos-rust-alternatives disable util-linux >/dev/null 2>&1
eq alt-disabled 0 'bunos-rust-alternatives status | grep -c " rust$"'
t util-linux-binary test -x /usr/lib/bunos/rust/util-linux/util-linux

# meta package and nushell defaults
t picks-json test -s /usr/share/bunos/rustbase/picks.json
eq nu-arith 3 'nu -c "1 + 2"'
t nu-in-shells grep -qx /usr/bin/nu /etc/shells
t skel-env test -f /etc/skel/.config/nushell/env.nu

echo "smoke: pass=$pass fail=$fail total=$((pass + fail))"
printf '{"pass":%d,"fail":%d,"total":%d,"failed":[%s]}\n' "$pass" "$fail" "$((pass + fail))" \
  "$(printf '"%s",' "${names[@]}" | sed 's/,$//')" >"${SMOKE_OUT:-/tmp/smoke.json}"
[ "$fail" -eq 0 ]
