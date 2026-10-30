#!/usr/bin/env bash
set -euo pipefail

# Install the VPS deploy adapter and the catalog snapshots it reads, from a
# clean aphrody-infra checkout on the host, as root:
#   aphrody-infra-deploy-aphrody  atomic-deploy-aphrody-stack.sh (four services)
# ADAPTER.json records the infra commit and every installed hash. Reinstall
# after changing any adapter or config/{service-catalog,secrets-contract}.json
# or yolo infra/config/host/nginx/routes.json (installed as nginx-routes.json).
yolo_routes="${YOLO_ROOT:-$HOME/src/aphrody}/infra/config/host/nginx/routes.json"
infra="${APHRODY_ADAPTER_SOURCE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
sbin="${APHRODY_ADAPTER_SBIN:-/usr/local/sbin}"
share="${APHRODY_ADAPTER_SHARE:-/usr/local/share/aphrody-infra}"
if [[ $# -gt 0 ]]; then echo 'usage: install-vps-adapter.sh' >&2; exit 2; fi
git_infra() { git -c safe.directory="$infra" -C "$infra" "$@"; }
commit="$(git_infra rev-parse --verify 'HEAD^{commit}')"
git_infra diff --quiet HEAD -- scripts config &&
  [[ -z "$(git_infra ls-files --others --exclude-standard -- scripts config)" ]] || {
  echo 'aphrody-infra scripts/ or config/ has uncommitted changes' >&2; exit 2;
}
[[ "$(id -u)" = 0 ]] || { echo 'run installation as root' >&2; exit 2; }
install -d -m 0755 "$sbin" "$share"
declare -A adapters=(
  [aphrody-infra-deploy-aphrody]=atomic-deploy-aphrody-stack.sh
)
for name in "${!adapters[@]}"; do install -m 0755 "$infra/scripts/release/${adapters[$name]}" "$sbin/$name"; done
for catalog in service-catalog secrets-contract; do
  install -m 0644 "$infra/tools/config/$catalog.json" "$share/$catalog.json"
done
install -m 0644 "$yolo_routes" "$share/nginx-routes.json"
# The site-only adapter was replaced by the four-service one.
rm -f -- "$sbin/aphrody-infra-deploy"
python3 - "$share/ADAPTER.json" "$commit" "$sbin" "$share" "${!adapters[@]}" <<'PY'
import datetime
import hashlib
import json
import pathlib
import sys
target, commit, sbin, share = sys.argv[1:5]
digest = lambda path: hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
manifest = {
    'schemaVersion': 1,
    'infraCommit': commit,
    'installedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
    'adapters': {name: digest(f'{sbin}/{name}') for name in sorted(sys.argv[5:])},
    'catalogs': {name: digest(f'{share}/{name}.json') for name in ('service-catalog', 'nginx-routes', 'secrets-contract')},
}
pathlib.Path(target).write_text(json.dumps(manifest, indent=2) + '\n')
PY
printf 'installed deploy adapters from aphrody-infra %s\n' "$commit"
