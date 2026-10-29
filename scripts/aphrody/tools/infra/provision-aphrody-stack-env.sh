#!/usr/bin/env bash
set +x
set -euo pipefail

# Provision the Aphrody stack runtime on the VPS as root. Never prints a
# generated credential. Two modes:
#
#   provision-aphrody-stack-env.sh
#       Existing host: an active legacy /etc/aphrody/aphrody-site.env exists.
#       Creates the aphrody_web / aphrody_ai_http roles, stages the next site and
#       Web env, writes the AI env; refuses any credential rotation. Run before
#       copy-aphrody-web-tables.sh (additive Web table copy).
#
#   provision-aphrody-stack-env.sh --fresh-host
#       Fresh host (no /etc/aphrody env yet, e.g. after the 2026-09-25
#       retirement): creates the aphrody system user, /home/ubuntu/apps/aphrody/shared,
#       the two login roles (or rotates their passwords: no env file on the host
#       holds the old ones), the staged site/Web env and the AI HTTP env. Run it after the PostgreSQL cluster is back
#       online and before `copy-aphrody-web-tables.sh --fresh-host`, which
#       restores the aphrody and aphrody_web databases from their dumps.
#
# The ubuntu PostgreSQL role defaults to read-only transactions; run with
# `sudo env PGOPTIONS=-cdefault_transaction_read_only=off ...`.
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
mode=existing
case "${1:-}" in
  '') ;;
  --fresh-host) mode=fresh ;;
  *) echo 'usage: provision-aphrody-stack-env.sh [--fresh-host]' >&2; exit 2 ;;
esac
for cmd in openssl psql pg_isready runuser install grep stat id; do command -v "$cmd" >/dev/null || { echo "missing $cmd" >&2; exit 2; }; done
env_dir=/etc/aphrody
root=/home/ubuntu/apps/aphrody
site_env="$env_dir/aphrody-site.env"
next_site_env="$env_dir/aphrody-site.next.env"
web_env="$env_dir/aphrody-web-api.env"
next_web_env="$env_dir/aphrody-web-api.next.env"
ai_env="$env_dir/aphrody-ai-http.env"
psql_admin() { runuser -u ubuntu -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }
role_exists() { runuser -u ubuntu -- psql -X -d postgres -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$1'" | grep -qx 1; }

runuser -u ubuntu -- pg_isready -q -d postgres || {
  echo 'PostgreSQL is not accepting connections; restart the cluster and run its integrity check first (docs/IMMUTABLE-RELEASES.md, All-in-one bundle)' >&2
  exit 2
}

shared_layout() {
  install -d -m 0755 -o root -g root "$root" "$root/releases" "$root/shared"
  install -d -m 0700 -o root -g root "$root/shared/deploy-backups"
  install -d -m 0700 -o ubuntu -g ubuntu "$root/shared/bxc" "$root/shared/bxc/storage" "$root/shared/bxc/cookies" \
    "$root/shared/coord" "$root/shared/a2a" "$root/shared/db-backups"
  install -d -m 0700 -o aphrody -g aphrody "$root/shared/ai" "$root/shared/ai/models"
  [[ -L "$root/shared/a2a/ai.json" ]] || ln -s "$root/current/ai.json" "$root/shared/a2a/ai.json"
  [[ -L "$root/shared/a2a/.coord" ]] || ln -s "$root/shared/coord" "$root/shared/a2a/.coord"
}

umask 077
web_password="$(openssl rand -hex 32)"
ai_password="$(openssl rand -hex 32)"
web_backend_token="$(openssl rand -hex 32)"
web_public_token="$(openssl rand -hex 32)"
printf -v web_dsn '%s://%s:%s@%s/%s' postgresql aphrody_web "$web_password" 127.0.0.1:5432 aphrody_web
printf -v ai_dsn '%s://%s:%s@%s/%s' postgresql aphrody_ai_http "$ai_password" 127.0.0.1:5432 aphrody

if [[ "$mode" = fresh ]]; then
  for file in "$site_env" "$next_site_env" "$web_env" "$next_web_env" "$ai_env"; do
    [[ ! -e "$file" ]] || { echo "$file exists: this is not a fresh host (use the default mode)" >&2; exit 2; }
  done
  command -v useradd >/dev/null || { echo "missing useradd" >&2; exit 2; }
  install -d -m 0750 -o root -g root "$env_dir"
  if ! id -u aphrody >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$root/shared/ai" --no-create-home --shell /usr/sbin/nologin aphrody
  fi
  shared_layout
  # Feed SQL on stdin, not argv. Passwords are hex and cannot alter SQL quoting.
  {
    printf "SET password_encryption = 'scram-sha-256';\n"
    for pair in "aphrody_web:$web_password" "aphrody_ai_http:$ai_password"; do
      role="${pair%%:*}"
      if role_exists "$role"; then
        printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$role" "${pair#*:}"
      else
        printf "CREATE ROLE %s LOGIN PASSWORD '%s';\n" "$role" "${pair#*:}"
      fi
    done
  } | psql_admin -d postgres
  printf 'BXC_API_TOKEN=%s\nAPHRODY_WEB_DATABASE_URL=%s\n' "$web_backend_token" "$web_dsn" > "$next_web_env"
  printf 'APHRODY_WEB_DATABASE_URL=%s\nAPHRODY_SITE_DATABASE_URL=%s\nAPHRODY_SITE_WEB_API_TOKEN=%s\nAPHRODY_BXC_API_TOKEN=%s\nAPHRODY_SITE_WEB_BACKEND_TOKEN=%s\n' \
    "$web_dsn" "$web_dsn" "$web_public_token" "$web_public_token" "$web_backend_token" > "$next_site_env"
  printf 'APHRODY_MCP_DATABASE_URL=%s
' "$ai_dsn" > "$ai_env"
  chmod 0600 "$next_site_env" "$next_web_env" "$ai_env"
  chown root:root "$next_site_env" "$next_web_env" "$ai_env"
  PGPASSWORD="$web_password" psql -X -h 127.0.0.1 -U aphrody_web -d postgres -Atqc 'SELECT 1' | grep -qx 1
  PGPASSWORD="$ai_password" psql -X -h 127.0.0.1 -U aphrody_ai_http -d postgres -Atqc 'SELECT 1' | grep -qx 1
  echo 'fresh host provisioned: aphrody user, shared layout, roles, staged site/Web env, AI env (0600)'
  echo 'next: copy-aphrody-web-tables.sh --fresh-host, TLS, then the stack adapter'
  exit 0
fi

[[ -f "$site_env" && "$(stat -c %a "$site_env")" = 600 ]] || { echo 'existing site env must be 0600 (use --fresh-host on a host without one)' >&2; exit 2; }
[[ ! -e "$next_site_env" && ! -e "$web_env" && ! -e "$next_web_env" && ! -e "$ai_env" ]] || { echo 'staged env already exists; refusing credential rotation' >&2; exit 2; }
for key in APHRODY_WEB_DATABASE_URL APHRODY_SITE_DATABASE_URL APHRODY_SITE_WEB_API_TOKEN APHRODY_WEB_API_TOKEN APHRODY_BXC_API_TOKEN APHRODY_SITE_WEB_BACKEND_TOKEN; do
  if grep -Eq "^$key=" "$site_env"; then echo "site env already contains $key; refusing overwrite" >&2; exit 2; fi
done
for role in aphrody_web aphrody_ai_http; do
  if role_exists "$role"; then echo "role $role already exists; refusing credential rotation" >&2; exit 2; fi
done
if runuser -u ubuntu -- psql -X -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = 'aphrody_web'" | grep -qx 1; then
  echo 'web database already exists; inspect before provisioning' >&2; exit 2
fi

backup="$root/shared/deploy-backups/site-env-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 -o root -g root "$root/shared/deploy-backups"
install -m 0600 -o root -g root "$site_env" "$backup"
install -m 0600 -o root -g root "$site_env" "$next_site_env"

printf "SET password_encryption = 'scram-sha-256';\nCREATE ROLE aphrody_web LOGIN PASSWORD '%s';\nCREATE ROLE aphrody_ai_http LOGIN PASSWORD '%s';\nGRANT CONNECT ON DATABASE aphrody TO aphrody_ai_http;\n" \
  "$web_password" "$ai_password" | psql_admin -d postgres
printf 'GRANT USAGE ON SCHEMA public TO aphrody_ai_http;\nGRANT SELECT, INSERT, UPDATE ON public.aphrody_rag_documents TO aphrody_ai_http;\nGRANT SELECT ON public.aphrody_rag_chunks TO aphrody_ai_http;\n' |
  psql_admin -d aphrody

shared_layout
printf 'BXC_API_TOKEN=%s\nAPHRODY_WEB_DATABASE_URL=%s\n' "$web_backend_token" "$web_dsn" > "$web_env"
install -m 0600 -o root -g root "$web_env" "$next_web_env"
printf 'APHRODY_MCP_DATABASE_URL=%s\n' "$ai_dsn" > "$ai_env"
printf 'APHRODY_WEB_DATABASE_URL=%s\nAPHRODY_SITE_DATABASE_URL=%s\nAPHRODY_SITE_WEB_API_TOKEN=%s\nAPHRODY_BXC_API_TOKEN=%s\nAPHRODY_SITE_WEB_BACKEND_TOKEN=%s\n' \
  "$web_dsn" "$web_dsn" "$web_public_token" "$web_public_token" "$web_backend_token" >> "$next_site_env"
chmod 0600 "$next_site_env" "$web_env" "$next_web_env" "$ai_env"
chown root:root "$next_site_env" "$web_env" "$next_web_env" "$ai_env"

PGPASSWORD="$web_password" psql -X -h 127.0.0.1 -U aphrody_web -d postgres -Atqc 'SELECT 1' | grep -qx 1
PGPASSWORD="$ai_password" psql -X -h 127.0.0.1 -U aphrody_ai_http -d aphrody -Atqc 'SELECT 1' | grep -qx 1
echo 'Aphrody Web and AI HTTP roles/env provisioned; next site env staged; active site env unchanged'
