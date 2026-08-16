#!/usr/bin/env bash
# Runs one mandatory staging-verification stage.
#
# On success it drops a completion marker so the gate can prove the stage ran.
# On failure it appends a redacted failure row so the gate and the published
# summary both reflect the failure, then propagates the exit code.
#
# usage: stage.sh <stage-name> <human label> <command> [args...]
#
# Requires STAGE_DIR and STAGING_RESULTS. Never echoes command environment.
set -uo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: stage.sh <stage-name> <label> <command> [args...]" >&2
  exit 2
fi

stage_name="$1"
label="$2"
shift 2

: "${STAGE_DIR:?STAGE_DIR must be set}"
: "${STAGING_RESULTS:?STAGING_RESULTS must be set}"
mkdir -p "$STAGE_DIR"
touch "$STAGING_RESULTS"

# Labels are authored in the workflow, never derived from output, so they are
# safe to embed. Escape quotes and backslashes anyway.
escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

if "$@"; then
  touch "$STAGE_DIR/$stage_name"
  exit 0
else
  # Capture inside the else branch: after `fi`, $? is the status of the `if`
  # statement itself (0), not of the command that failed.
  exit_code=$?
fi

# Never let a failed stage report success, whatever the command returned.
if [ "$exit_code" -eq 0 ]; then exit_code=1; fi

printf '{"section":"Pipeline","check":"%s","status":"fail","detail":"stage %s failed with exit code %s"}\n' \
  "$(escape "$label")" "$(escape "$stage_name")" "$exit_code" >>"$STAGING_RESULTS"
echo "::error::Stage '$stage_name' failed with exit code $exit_code."
exit "$exit_code"
