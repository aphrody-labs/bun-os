#!/usr/bin/env bash
set -Eeuo pipefail

# Activate one Aphrody stack release: four loopback services (aphrody-site,
# aphrody-web-api, aphrody-a2a, aphrody-ai-http) behind the aphrody.com apex
# vhost. Requires the packaged local smoke attestation (SMOKE.json, written by
# smoke-aphrody-stack-local.py --attest) to match the release checksums. Any
# failure restores the previous units, apex vhost, active env files and
# `current`, and restarts what was running before.
#
#   atomic-deploy-aphrody-stack.sh /home/ubuntu/apps/aphrody/releases/ID
#   atomic-deploy-aphrody-stack.sh --restore BACKUP_DIR
#
# `--restore` re-applies the backup written by an earlier activation.
# APHRODY_STACK_BACKUP_DIR selects where the activation backup goes (default
# shared/deploy-backups).
usage='usage: atomic-deploy-aphrody-stack.sh /home/ubuntu/apps/aphrody/releases/ID | --restore BACKUP_DIR'
[[ $# -ge 1 && $# -le 2 ]] || { echo "$usage" >&2; exit 2; }
root="${APHRODY_RELEASE_ROOT:-/home/ubuntu/apps/aphrody}"
current="$root/current"
env_dir=/etc/aphrody
conf=/etc/nginx/conf.d/aphrody-apex.conf
services=(aphrody-web-api aphrody-a2a aphrody-ai-http aphrody-site)
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }

restore_backup() {
  local backup="$1" service previous state name
  # The roster written at activation time is authoritative for what to restore.
  if [[ -f "$backup/roster" ]]; then mapfile -t services < "$backup/roster"; fi
  for service in "${services[@]}"; do systemctl stop "$service.service" 2>/dev/null || true; done
  for service in "${services[@]}"; do
    state="$(cat "$backup/$service.enabled" 2>/dev/null || true)"
    case "$state" in enabled|enabled-runtime) ;; *) systemctl disable "$service.service" >/dev/null 2>&1 || true ;; esac
    if [[ -e "$backup/$service.service" ]]; then
      cp -a -- "$backup/$service.service" "/etc/systemd/system/$service.service"
    else
      rm -f -- "/etc/systemd/system/$service.service"
    fi
  done
  if [[ -e "$backup/aphrody-apex.conf" ]]; then cp -a -- "$backup/aphrody-apex.conf" "$conf"; else rm -f -- "$conf"; fi
  for name in aphrody-site aphrody-web-api; do
    if [[ -e "$backup/$name.env" ]]; then cp -a -- "$backup/$name.env" "$env_dir/$name.env"; else rm -f -- "$env_dir/$name.env"; fi
  done
  previous="$(cat "$backup/previous-release" 2>/dev/null || true)"
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn -- "$previous" "$root/.current.rollback.$$"
    mv -Tf -- "$root/.current.rollback.$$" "$current"
  else
    # First activation: there was no pointer before this release.
    rm -f -- "$current"
  fi
  systemctl daemon-reload || true
  if nginx -t; then systemctl reload nginx || true; fi
  for service in "${services[@]}"; do
    state="$(cat "$backup/$service.enabled" 2>/dev/null || true)"
    case "$state" in enabled|enabled-runtime) systemctl enable "$service.service" >/dev/null 2>&1 || true ;; esac
    if [[ "$(cat "$backup/$service.active" 2>/dev/null || true)" = active ]]; then systemctl restart "$service.service" || true; fi
  done
}

if [[ "$1" = --restore ]]; then
  [[ $# -eq 2 ]] || { echo "$usage" >&2; exit 2; }
  backup="$(realpath -e -- "$2")"
  [[ "$(cat "$backup/kind" 2>/dev/null || true)" = aphrody-stack && -f "$backup/previous-release" ]] || {
    echo "not an Aphrody stack activation backup: $backup" >&2; exit 2;
  }
  restore_backup "$backup"
  printf 'restored Aphrody stack from %s; current=%s\n' "$backup" "$(if [[ -L "$current" ]]; then readlink -f -- "$current"; else echo none; fi)"
  exit 0
fi
[[ $# -eq 1 ]] || { echo "$usage" >&2; exit 2; }

release="$(realpath -e -- "$1")"
[[ "$release" = "$(realpath -m -- "$root/releases")/"* ]] || { echo 'release must be under release root' >&2; exit 2; }
required_files=(bin/{aphrody-site,aphrody-web-api,aphrody,aphrody-mcp} lib/{libaphrody_web_ffi.so,libbxc_render.so} ai.json RELEASE_SHA RELEASE_ID SHA256SUMS SMOKE.json nginx/aphrody-apex.conf)
for file in "${required_files[@]}"; do
  [[ -r "$release/$file" ]] || { echo "missing $file" >&2; exit 2; }
done
for command in curl jq python3 sha256sum ss runuser; do command -v "$command" >/dev/null || { echo "missing $command" >&2; exit 2; }; done
for service in "${services[@]}"; do [[ -r "$release/systemd/$service.service" ]] || { echo "missing unit: $service" >&2; exit 2; }; done
(cd "$release" && sha256sum --quiet --check SHA256SUMS)
python3 - "$release" "${services[@]}" <<'PY' || { echo 'SMOKE.json does not attest this release (smoke-aphrody-stack-local.py --attest)' >&2; exit 2; }
import hashlib
import json
import pathlib
import sys

release, roster = pathlib.Path(sys.argv[1]), sys.argv[2:]
smoke = json.loads((release / 'SMOKE.json').read_text())
ok = (smoke.get('status') == 'ok'
      and smoke.get('releaseId') == (release / 'RELEASE_ID').read_text().strip()
      and smoke.get('sha256sums') == hashlib.sha256((release / 'SHA256SUMS').read_bytes()).hexdigest()
      and sorted(smoke.get('services') or []) == sorted(roster)
      and smoke.get('schema') == 'aphrody-stack-smoke/v1')
sys.exit(0 if ok else 1)
PY
[[ -L "$release/.coord" && "$(readlink -- "$release/.coord")" = /home/ubuntu/apps/aphrody/shared/coord ]] || { echo 'persistent .coord link missing' >&2; exit 2; }
id -u aphrody >/dev/null 2>&1 || { echo 'system user aphrody missing (provision-aphrody-stack-env.sh --fresh-host)' >&2; exit 2; }

# Active site/Web env files are optional (fresh host); staged and AI env are not.
for name in aphrody-site.next aphrody-web-api.next aphrody-ai-http; do
  envfile="$env_dir/$name.env"
  [[ -f "$envfile" && "$(stat -c %a "$envfile")" = 600 ]] || { echo "missing 0600 $envfile" >&2; exit 2; }
done
for name in aphrody-site aphrody-web-api aphrody-a2a; do
  envfile="$env_dir/$name.env"
  [[ ! -e "$envfile" || "$(stat -c %a "$envfile")" = 600 ]] || { echo "$envfile must be 0600" >&2; exit 2; }
done
if grep -Eq '^APHRODY_WEB_API_TOKEN=' "$env_dir/aphrody-site.next.env"; then
  echo 'AI backend token variable must not be in site env' >&2; exit 2;
fi
for pair in 'aphrody-site.next:APHRODY_WEB_DATABASE_URL' 'aphrody-site.next:APHRODY_SITE_DATABASE_URL' 'aphrody-site.next:APHRODY_SITE_WEB_API_TOKEN' 'aphrody-site.next:APHRODY_BXC_API_TOKEN' 'aphrody-site.next:APHRODY_SITE_WEB_BACKEND_TOKEN' 'aphrody-web-api.next:BXC_API_TOKEN' 'aphrody-web-api.next:APHRODY_WEB_DATABASE_URL'; do
  name="${pair%%:*}"; key="${pair#*:}"
  grep -Eq "^$key=" "$env_dir/$name.env" || { echo "missing $key in $name.env" >&2; exit 2; }
done
grep -Eq '^APHRODY_MCP_DATABASE_URL=' "$env_dir/aphrody-ai-http.env" || { echo 'missing APHRODY_MCP_DATABASE_URL in aphrody-ai-http.env' >&2; exit 2; }
web_dsn="$(sed -n 's/^APHRODY_WEB_DATABASE_URL=//p' "$env_dir/aphrody-site.next.env")"
legacy_web_dsn="$(sed -n 's/^APHRODY_SITE_DATABASE_URL=//p' "$env_dir/aphrody-site.next.env")"
web_api_dsn="$(sed -n 's/^APHRODY_WEB_DATABASE_URL=//p' "$env_dir/aphrody-web-api.next.env")"
site_public_token="$(sed -n 's/^APHRODY_SITE_WEB_API_TOKEN=//p' "$env_dir/aphrody-site.next.env")"
legacy_public_token="$(sed -n 's/^APHRODY_BXC_API_TOKEN=//p' "$env_dir/aphrody-site.next.env")"
site_backend_token="$(sed -n 's/^APHRODY_SITE_WEB_BACKEND_TOKEN=//p' "$env_dir/aphrody-site.next.env")"
web_backend_token="$(sed -n 's/^BXC_API_TOKEN=//p' "$env_dir/aphrody-web-api.next.env")"
[[ "$site_public_token" =~ ^[0-9a-f]{64}$ && "$site_public_token" = "$legacy_public_token" ]] || {
  echo 'site public Web token aliases differ or are invalid' >&2; exit 2;
}
[[ "$site_backend_token" =~ ^[0-9a-f]{64}$ && "$site_backend_token" = "$web_backend_token" ]] || {
  echo 'site and integrated Web API backend tokens differ or are invalid' >&2; exit 2;
}
[[ -n "$web_dsn" && "$web_dsn" = "$legacy_web_dsn" && "$web_dsn" = "$web_api_dsn" ]] || {
  echo 'site and Web API DSNs differ' >&2; exit 2;
}
printf '%s' "$web_dsn" | python3 -c 'import sys,urllib.parse; p=urllib.parse.urlsplit(sys.stdin.read()); sys.exit(0 if p.scheme in ("postgres","postgresql") and p.hostname in ("127.0.0.1","localhost") and p.username == "aphrody_web" and p.path == "/aphrody_web" else 1)' || {
  echo 'Web DSN does not target local aphrody_web as aphrody_web' >&2; exit 2;
}
for dir in "$root/shared/bxc" "$root/shared/bxc/storage" "$root/shared/coord" "$root/shared/a2a" "$root/shared/ai" "$root/shared/ai/models"; do [[ -d "$dir" ]] || { echo "missing shared directory: $dir" >&2; exit 2; }; done
[[ "$(stat -c %U "$root/shared/bxc/storage")" = ubuntu ]] || { echo 'Web storage directory must belong to ubuntu' >&2; exit 2; }
# A loopback port that already listens must belong to the unit that will own it.
assert_port_owned() {
  local port="$1" unit="$2" listener unit_pid
  listener="$(ss -H -ltnp "( sport = :$port )" | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -n 1)"
  [[ -z "$listener" ]] && return 0
  unit_pid="$(systemctl show -p MainPID --value "$unit.service")"
  [[ "$unit_pid" =~ ^[1-9][0-9]*$ && "$listener" = "$unit_pid" ]] && grep -Fq "/$unit.service" "/proc/$listener/cgroup" || {
    echo "port $port is owned by another process than $unit" >&2; exit 2;
  }
}
assert_port_owned 3007 aphrody-web-api
[[ -L "$root/shared/a2a/ai.json" && "$(readlink -- "$root/shared/a2a/ai.json")" = "$root/current/ai.json" ]] || { echo 'A2A manifest link missing' >&2; exit 2; }
[[ -L "$root/shared/a2a/.coord" && "$(readlink -- "$root/shared/a2a/.coord")" = "$root/shared/coord" ]] || { echo 'A2A mailbox link missing' >&2; exit 2; }
for dir in "$root/shared/ai" "$root/shared/ai/models"; do
  [[ "$(stat -c %U "$dir")" = aphrody ]] || { echo "AI state directory must belong to aphrody: $dir" >&2; exit 2; }
done

backup="${APHRODY_STACK_BACKUP_DIR:-$root/shared/deploy-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
install -d -m 0700 "$backup"
[[ -z "$(ls -A -- "$backup")" ]] || { echo "backup directory is not empty: $backup" >&2; exit 2; }
previous=""
if [[ -L "$current" ]]; then previous="$(readlink -f -- "$current")"; fi
[[ ! -e "$current" || -L "$current" ]] || { echo "current is not a symlink" >&2; exit 2; }
[[ -z "$previous" || "$previous" = "$(realpath -m -- "$root/releases")/"* ]] || { echo 'current points outside the release root' >&2; exit 2; }
printf 'aphrody-stack\n' > "$backup/kind"
printf '%s\n' "$previous" > "$backup/previous-release"
printf '%s\n' "$release" > "$backup/target-release"
printf '%s\n' "${services[@]}" > "$backup/roster"
for service in "${services[@]}"; do
  systemctl is-enabled "$service.service" > "$backup/$service.enabled" 2>/dev/null || true
  systemctl is-active "$service.service" > "$backup/$service.active" 2>/dev/null || true
  if [[ -e "/etc/systemd/system/$service.service" ]]; then
    cp -a -- "/etc/systemd/system/$service.service" "$backup/$service.service"
  fi
done
if [[ -e "$conf" ]]; then cp -a -- "$conf" "$backup/aphrody-apex.conf"; fi
for name in aphrody-site aphrody-web-api; do
  if [[ -e "$env_dir/$name.env" ]]; then cp -a -- "$env_dir/$name.env" "$backup/$name.env"; fi
done
activated=no
fixture_pid=''
fixture_dir=''
clean_fixture() {
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fi
  if [[ -n "$fixture_dir" ]]; then rm -rf -- "$fixture_dir"; fi
}
rollback() {
  local status=$?
  trap - EXIT
  clean_fixture
  if [[ "$activated" = yes ]]; then restore_backup "$backup"; fi
  echo "activation failed; rollback attempted; backup=$backup" >&2
  exit "$status"
}
trap rollback EXIT
activated=yes
for service in "${services[@]}"; do install -m 0644 "$release/systemd/$service.service" "/etc/systemd/system/$service.service"; done
install -m 0644 "$release/nginx/aphrody-apex.conf" "$conf"
install -m 0600 -o root -g root "$env_dir/aphrody-site.next.env" "$env_dir/aphrody-site.env"
install -m 0600 -o root -g root "$env_dir/aphrody-web-api.next.env" "$env_dir/aphrody-web-api.env"
nginx -t
systemctl daemon-reload
ln -sfn -- "$release" "$root/.current.new.$$"
mv -Tf -- "$root/.current.new.$$" "$current"
for service in "${services[@]}"; do systemctl restart "$service.service"; done
# systemctl restart can return before a crashing service loses its listener.
sleep 2
for service in "${services[@]}"; do
  systemctl is-active --quiet "$service.service" || { echo "service failed after start: $service" >&2; exit 1; }
done
binary_specs=('aphrody-site:aphrody-site' 'aphrody-web-api:aphrody-web-api' 'aphrody-a2a:aphrody' 'aphrody-ai-http:aphrody-mcp')
for spec in "${binary_specs[@]}"; do
  service="${spec%%:*}"
  binary="${spec#*:}"
  main_pid="$(systemctl show -p MainPID --value "$service.service")"
  configured="$(systemctl show -p ExecStart --value "$service.service")"
  expected_exe="$(realpath -e -- "$release/bin/$binary")"
  [[ "$main_pid" =~ ^[1-9][0-9]*$ && "$configured" == *"path=/home/ubuntu/apps/aphrody/current/bin/$binary ;"* ]] || {
    echo "service $service does not start the release binary" >&2; exit 1;
  }
  [[ "$(readlink -e -- "/proc/$main_pid/exe")" = "$expected_exe" ]] || {
    echo "service $service is running an old binary" >&2; exit 1;
  }
  running_sha="$(sha256sum "/proc/$main_pid/exe" | cut -d' ' -f1)"
  release_sha="$(sha256sum "$release/bin/$binary" | cut -d' ' -f1)"
  [[ "$running_sha" = "$release_sha" ]] || {
    echo "service $service executable hash differs from release" >&2; exit 1;
  }
done
web_pid="$(systemctl show -p MainPID --value aphrody-web-api.service)"
listener_pid="$(ss -H -ltnp '( sport = :3007 )' | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -n 1)"
[[ "$web_pid" =~ ^[1-9][0-9]*$ && "$listener_pid" = "$web_pid" ]] || {
  echo "Web listener on 3007 is not owned by aphrody-web-api.service" >&2
  exit 1
}
grep -Fq '/aphrody-web-api.service' "/proc/$listener_pid/cgroup" || {
  echo "Web listener on 3007 has the wrong cgroup" >&2
  exit 1
}

probe() {
  local url="$1"
  for _ in $(seq 1 30); do curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "probe failed: $url" >&2; return 1
}
probe http://127.0.0.1:3007/health
probe http://127.0.0.1:8788/ping
probe http://127.0.0.1:8789/healthz
probe http://127.0.0.1:8083/healthz
nginx -t
systemctl reload nginx
apex_probe() {
  local path="$1" status=000
  # nginx reload is asynchronous: an old worker can briefly return 404.
  for _ in $(seq 1 30); do
    status="$(curl --noproxy '*' --silent --show-error --max-time 5 \
      -o /dev/null -w '%{http_code}' --resolve aphrody.com:443:127.0.0.1 \
      "https://aphrody.com$path")" || status=000
    [[ "$status" = 200 ]] && return 0
    sleep 1
  done
  echo "apex probe failed: $path HTTP $status" >&2
  return 1
}
for path in /healthz /api/v1/a2a/ping /api/v1/models; do
  apex_probe "$path"
done
rankings="$(curl --noproxy '*' --fail --silent --show-error --max-time 5 \
  --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/api/v1/bxc/rankings)"
printf '%s' "$rankings" | jq -e '(.status == "unavailable" and (.top_ranking_targets | length) == 0) or (.status == "analyzed" and all(.top_ranking_targets[]; .status == "reported_with_provenance"))' >/dev/null || {
  echo 'public rankings contain unverified measurements' >&2; exit 1;
}
if [[ "${APHRODY_STACK_EXPECT_EMPTY_RANKINGS:-}" = yes ]]; then
  printf '%s' "$rankings" | jq -e '.status == "unavailable" and (.top_ranking_targets | length) == 0' >/dev/null || {
    echo 'public rankings are not empty after filtering legacy seed data' >&2; exit 1;
  }
fi
card="$(curl --noproxy '*' --fail --silent --show-error --max-time 5 \
  --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/.well-known/agent-card.json)"
printf '%s' "$card" | jq -e 'any(.supportedInterfaces[]; .url == "https://aphrody.com/api/v1/a2a" and .protocolVersion == "1.0")' >/dev/null
public_manifest="$(curl --noproxy '*' -fsS --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/ai.json | sha256sum | cut -d' ' -f1)"
expected_manifest="$(sha256sum "$release/ai.json" | cut -d' ' -f1)"
[[ "$public_manifest" = "$expected_manifest" ]] || { echo 'public ai.json differs from pinned manifest' >&2; exit 1; }
public_token="$(sed -n 's/^APHRODY_SITE_WEB_API_TOKEN=//p' "$env_dir/aphrody-site.env" | tail -n 1)"
[[ "$public_token" =~ ^[0-9a-f]{64}$ ]] || { echo 'public Web token must be a 64-character hex value' >&2; exit 1; }
unauth_status="$(curl --noproxy '*' --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' \
  --resolve aphrody.com:443:127.0.0.1 -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:33907/index.html","profile":"static"}' \
  https://aphrody.com/api/v1/web/scrape)"
[[ "$unauth_status" = 401 ]] || { echo "public Web unauthenticated probe returned HTTP $unauth_status" >&2; exit 1; }
deny_status="$(printf 'header = "Authorization: Bearer %s"\n' "$public_token" | \
  curl --config - --noproxy '*' --silent --show-error --max-time 5 -o /dev/null -w '%{http_code}' \
    --resolve aphrody.com:443:127.0.0.1 https://aphrody.com/api/v1/web/not-allowlisted)"
[[ "$deny_status" = 404 ]] || { echo "public Web allowlist probe returned HTTP $deny_status" >&2; exit 1; }
fixture_dir="$(mktemp -d /tmp/aphrody-web-probe.XXXXXXXX)"
printf '<!doctype html><title>Aphrody Web probe</title><h1>Local fixture</h1>' > "$fixture_dir/index.html"
python3 -m http.server 33907 --bind 127.0.0.1 --directory "$fixture_dir" > "$fixture_dir/server.log" 2>&1 &
fixture_pid=$!
probe http://127.0.0.1:33907/index.html
probe_status="$(printf 'header = "Authorization: Bearer %s"\n' "$public_token" | \
  curl --config - --noproxy '*' --silent --show-error --max-time 30 -o "$fixture_dir/scrape.json" -w '%{http_code}' \
    --resolve aphrody.com:443:127.0.0.1 -H 'Content-Type: application/json' \
    -d '{"url":"http://127.0.0.1:33907/index.html","profile":"static"}' \
    https://aphrody.com/api/v1/web/scrape)"
[[ "$probe_status" = 200 ]] && grep -Fq 'Aphrody Web probe' "$fixture_dir/scrape.json" || {
  echo "public Web scrape probe failed: HTTP $probe_status" >&2; exit 1;
}
clean_fixture
for service in "${services[@]}"; do systemctl enable "$service.service" >/dev/null; done
rm -f -- "$env_dir/aphrody-site.next.env" "$env_dir/aphrody-web-api.next.env"
trap - EXIT
printf 'activated Aphrody stack %s; previous=%s; backup=%s\n' "$(cat "$release/RELEASE_ID")" "${previous:-none}" "$backup"
