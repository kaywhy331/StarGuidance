#!/bin/sh
set -eu

read_secret() {
  secret_path="$1"
  secret_name="$2"
  if [ ! -f "$secret_path" ]; then
    echo "missing required secret file: $secret_name" >&2
    exit 1
  fi
  IFS= read -r secret_value < "$secret_path"
  if [ "${#secret_value}" -lt 32 ]; then
    echo "required secret is too short: $secret_name" >&2
    exit 1
  fi
  export "$secret_name=$secret_value"
  unset secret_value
}

read_secret /run/secrets/tokenpak_proxy_auth_token TOKENPAK_PROXY_AUTH_TOKEN
read_secret /run/secrets/tokenpak_egress_token TOKENPAK_EGRESS_TOKEN
export TOKENPAK_CONFIG=/etc/tokenpak/config.yaml

required_settings='TOKENPAK_PROFILE=safe
TOKENPAK_UPSTREAM_RETRIES=1
TOKENPAK_UPSTREAM_RECOVERY_DIR=/proc/tokenpak-recovery-disabled
TOKENPAK_RETRY_PERSIST_BODY=0
TOKENPAK_COMPACT=0
TOKENPAK_QUERY_EXPANSION_ENABLED=0
TOKENPAK_TERM_RESOLVER_ENABLED=0
TOKENPAK_TRACE=0
TOKENPAK_VAULT_INJECTION=0'
printf '%s\n' "$required_settings" | while IFS='=' read -r setting expected; do
  eval "actual=\${$setting-}"
  if [ "$actual" != "$expected" ]; then
    echo "unsafe TokenPak runtime setting: $setting" >&2
    exit 1
  fi
done

exec python -m tokenpak.proxy.server \
  --config /etc/tokenpak/config.yaml \
  --port 8766 \
  --profile safe \
  --log-level error
