# Tiny assertion helpers. Every check prints one line: PASS/FAIL, name, milliseconds.
fails=0
now() { date +%s%3N; }
check() { # name, expected-substring, command...
  name=$1; want=$2; shift 2
  t0=$(now); out=$("$@" 2>&1); rc=$?; t1=$(now)
  if [ $rc -eq 0 ] && { [ -z "$want" ] || printf "%s" "$out" | grep -qF -- "$want"; }; then echo "PASS $name ($((t1-t0)) ms)"
  else echo "FAIL $name (rc=$rc, want '$want')"; printf '%s\n' "$out" | tail -15; fails=$((fails+1)); fi
}
finish() { [ "$fails" -eq 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }; }
