#!/usr/bin/env bash
# Rehearses a forward application-encryption rotation and a guaranteed rollback
# against the explicitly disposable staging project. Only fixed status text and
# counts emitted by the TypeScript rotation tool may reach the workflow log.
set -euo pipefail

operation="${1:-}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${ORIGINAL_ENCRYPTION_KEY:?ORIGINAL_ENCRYPTION_KEY must be set}"
: "${ROTATION_REHEARSAL_KEY:?ROTATION_REHEARSAL_KEY must be set}"
: "${STAGING_RESULTS:?STAGING_RESULTS must be set}"

if [ "${APP_ENV:-}" != "staging" ] || \
   [ "${KEY_ROTATION_REHEARSAL_CONFIRM:-}" != "SYNTHETIC_DISPOSABLE_STAGING" ]; then
  echo "::error::Key rotation rehearsal requires the protected disposable staging boundary."
  exit 1
fi
if [ "$ORIGINAL_ENCRYPTION_KEY" = "$ROTATION_REHEARSAL_KEY" ]; then
  echo "::error::The ephemeral rehearsal key must differ from the configured staging key."
  exit 1
fi

run_rotation() {
  KEY_ROTATION_MODE="$1" \
  DATA_ENCRYPTION_KEY="$2" \
  DATA_ENCRYPTION_KEYS_PREVIOUS="$3" \
  KEY_ROTATION_CONFIRM="${4:-}" \
  KEY_ROTATION_SYNTHETIC_ONLY=true \
  KEY_ROTATION_REQUIRE_ROWS=true \
  KEY_ROTATION_REQUIRE_CHANGES="${5:-false}" \
    corepack pnpm --filter @starguidance/database key-rotation
}

case "$operation" in
  forward)
    # Prove the deployed key authenticates every current row before writing.
    run_rotation verify-current "$ORIGINAL_ENCRYPTION_KEY" "$ROTATION_REHEARSAL_KEY"
    # Move every envelope to a fresh ephemeral key, then prove no old-key row remains.
    run_rotation reencrypt "$ROTATION_REHEARSAL_KEY" "$ORIGINAL_ENCRYPTION_KEY" \
      REENCRYPT_WITH_CURRENT_KEY true
    run_rotation verify-current "$ROTATION_REHEARSAL_KEY" "$ORIGINAL_ENCRYPTION_KEY"
    printf '%s\n' \
      '{"section":"Key rotation","check":"Forward re-encryption rehearsal","status":"pass","detail":"synthetic encrypted rows moved to an ephemeral current key and authenticated without fallback"}' \
      >>"$STAGING_RESULTS"
    ;;
  rollback)
    # This path is always invoked, including after a partial forward failure.
    # Both keys remain available, so every changed row can return to the key the
    # deployed application still uses before synthetic cleanup begins.
    run_rotation reencrypt "$ORIGINAL_ENCRYPTION_KEY" "$ROTATION_REHEARSAL_KEY" \
      REENCRYPT_WITH_CURRENT_KEY false
    run_rotation verify-current "$ORIGINAL_ENCRYPTION_KEY" "$ROTATION_REHEARSAL_KEY"
    printf '%s\n' \
      '{"section":"Key rotation","check":"Rollback to configured staging key","status":"pass","detail":"every synthetic encrypted row returned to the configured staging key and authenticated without fallback"}' \
      >>"$STAGING_RESULTS"
    ;;
  *)
    echo "usage: rehearse-key-rotation.sh forward|rollback" >&2
    exit 2
    ;;
esac
