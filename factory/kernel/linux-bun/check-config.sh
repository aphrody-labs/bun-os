#!/bin/bash
# SPDX-License-Identifier: 0BSD
# check-config.sh FRAGMENT CONFIG
#
# Fails when a line of a kernel config fragment is not present, verbatim, in the final .config
# (merge_config.sh warns about that but does not fail). Fragment lines are either
# `CONFIG_FOO=value` or `# CONFIG_FOO is not set`; every other line is a comment.
set -euo pipefail

if (($# != 2)); then
  echo "usage: ${0##*/} FRAGMENT CONFIG" >&2
  exit 2
fi
fragment=$1
config=$2
[[ -r $fragment ]] || { echo "${0##*/}: cannot read $fragment" >&2; exit 2; }
[[ -r $config ]] || { echo "${0##*/}: cannot read $config" >&2; exit 2; }

checked=0
failed=0
while IFS= read -r line || [[ -n $line ]]; do
  if [[ $line =~ ^(CONFIG_[A-Za-z0-9_]+)=.+$ ]] || [[ $line =~ ^#\ (CONFIG_[A-Za-z0-9_]+)\ is\ not\ set$ ]]; then
    sym=${BASH_REMATCH[1]}
  else
    continue
  fi
  checked=$((checked + 1))
  if grep -qxF -- "$line" "$config"; then
    continue
  fi
  actual=$(grep -E -- "^(# )?${sym}([ =]|$)" "$config" || true)
  echo "config mismatch: wanted '$line', final .config has '${actual:-<absent>}'" >&2
  failed=$((failed + 1))
done <"$fragment"

if ((checked == 0)); then
  echo "${0##*/}: no CONFIG_ lines found in $fragment" >&2
  exit 2
fi
if ((failed > 0)); then
  echo "${0##*/}: $failed of $checked fragment lines did not survive olddefconfig" >&2
  exit 1
fi
echo "${0##*/}: all $checked fragment lines present in $config"
