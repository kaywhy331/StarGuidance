# AI gateway and tunnel security

## Status

StarGuidance supports two fail-closed provider routes:

1. direct server-to-server Groq; and
2. a separately approved HTTPS `/v1` gateway protected by Cloudflare Access.

The second route is not deployment approval. This repository contains a
reviewable, default-off runtime blueprint and synthetic tests under
`infra/cali-tokenpak`; it does not create or prove a Cali host, live container,
named tunnel, Access policy, host egress firewall, custom provider route, or
TokenPak deployment. The deterministic reader remains the safe fallback. See
[the pilot runbook](CALI-TOKENPAK-PILOT.md).

TokenPak is an LLM proxy and prompt-packing layer, not an inference model. If it
is used, Groq remains the upstream inference provider for the reviewed chain:
`openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, then
`openai/gpt-oss-20b`.

## Hard prohibition: never publish raw TokenPak

Do not point a Cloudflare Tunnel, public hostname, Quick Tunnel, reverse proxy,
load balancer, or port-forward directly at a TokenPak listener. A local tunnel
connector reaches its origin from the host, so an origin that exempts localhost
from authentication cannot use that exemption as an Internet security boundary.
Access authenticates a request at Cloudflare's edge; it does not remove unsafe
origin routes.

Only a purpose-built gateway may be the tunnel origin. The gateway must construct
one fixed upstream request and must not behave as a general forward proxy.

```text
StarGuidance server
  -> Cloudflare Access (Service Auth, default deny)
  -> named Cloudflare Tunnel
  -> narrow gateway in an isolated workload
  -> loopback/private TokenPak listener
  -> api.groq.com:443
```

The gateway origin exposes exactly `POST /v1/chat/completions`. It rejects every
other method and path, including absolute-form request targets, `CONNECT`,
`/codex`, `/tpk`, `/pak`, model discovery, dashboards, health/metrics exports,
sessions, traces, journals, capsules, vaults, budgets, and telemetry APIs. It
must never derive an upstream URL, hostname, or path from caller-controlled
input.

## Credential separation

Use four independently rotatable trust domains:

| Trust domain            | Stored by                      | Sent to             | Purpose                                             |
| ----------------------- | ------------------------------ | ------------------- | --------------------------------------------------- |
| Named-tunnel credential | tunnel connector only          | Cloudflare Tunnel   | registers the connector                             |
| Access service identity | StarGuidance host              | Cloudflare Access   | `CF-Access-Client-Id` and `CF-Access-Client-Secret` |
| Gateway bearer          | StarGuidance host and gateway  | narrow gateway only | authenticates the application after Access          |
| Groq API key            | isolated gateway workload only | Groq                | pays for and authorizes inference                   |

Do not reuse one value for two rows. In gateway mode the StarGuidance host must
not retain `AI_PROVIDER_API_KEY`; it sends `AI_PROVIDER_GATEWAY_KEY` as its
bearer instead. TokenPak or the gateway injects the Groq key only on the fixed
outbound Groq request. No browser receives any of these credentials.

Current Cloudflare service-token authentication uses both
`CF-Access-Client-Id` and `CF-Access-Client-Secret`. The Access application must
use a `Service Auth` policy scoped to this one service token. A valid Access
identity is necessary but not sufficient: the gateway bearer, route contract,
model allowlist, resource limits, and origin isolation are independently
required.

## StarGuidance configuration

Direct Groq mode:

```text
AI_PROVIDER=groq
AI_PROVIDER_TRANSPORT=direct
AI_PROVIDER_BASE_URL=https://api.groq.com/openai/v1
AI_PROVIDER_API_KEY=<managed Groq secret>
AI_PROVIDER_GATEWAY_APPROVED=false
AI_PROVIDER_GATEWAY_KEY=
AI_PROVIDER_CF_ACCESS_CLIENT_ID=
AI_PROVIDER_CF_ACCESS_CLIENT_SECRET=
```

Approved gateway mode:

```text
AI_PROVIDER=groq
AI_PROVIDER_TRANSPORT=tokenpak
AI_PROVIDER_BASE_URL=https://<reviewed-gateway-host>/v1
AI_PROVIDER_API_KEY=
AI_PROVIDER_GATEWAY_APPROVED=true
AI_PROVIDER_GATEWAY_HOST=<reviewed-gateway-host>
AI_PROVIDER_GATEWAY_KEY=<distinct managed gateway bearer>
AI_PROVIDER_CF_ACCESS_CLIENT_ID=<managed Access client ID>
AI_PROVIDER_CF_ACCESS_CLIENT_SECRET=<managed Access client secret>
```

The adapter accepts no HTTP gateway, loopback or IP-literal origin, URL
userinfo, query, fragment, or path other than exactly `/v1`. A custom route
without the approval flag, gateway bearer, and complete Access pair falls back
deterministically. Stale gateway credentials configured against direct Groq
also fail closed. This application validation does not replace DNS, firewall,
or egress enforcement.

## Isolated workload baseline

Run the gateway and its dedicated TokenPak instance in a disposable container,
microVM, or dedicated VM identity—not under an interactive agent account.
Minimum controls:

- unprivileged UID/GID; read-only root filesystem; writable ephemeral scratch
  and an instance-specific ephemeral `TOKENPAK_HOME` only;
- no host home, vault, repository, SSH, agent-runtime, credential-store, socket,
  Docker/Podman, or Kubernetes control-plane mounts;
- all Linux capabilities dropped, `no-new-privileges`, a restrictive seccomp or
  equivalent policy, and bounded PID, memory, CPU, file-descriptor, and disk
  quotas;
- TokenPak bound only to loopback or a private workload network unreachable by
  the tunnel connector except through the gateway;
- outbound allowlist limited to the DNS path required by the runtime and
  `api.groq.com:443`; explicitly block loopback, RFC1918/ULA, link-local,
  platform metadata, and internal service ranges;
- no shell, tool/function execution, repository access, retrieval, vault
  injection, model discovery, or arbitrary URL fetch in the request path; and
- immutable image digest, dependency inventory, non-root health check, and a
  documented rebuild/rollback procedure.

Cloudflare Sandbox may be useful for disposable untrusted-code execution, but
using its preview-port feature would expose another public service surface. It
is not a substitute for this named-Tunnel, Access, narrow-gateway, and egress
design. A conventional hardened container or microVM is sufficient when no
untrusted code is executed.

## Gateway request contract

The gateway must parse and re-serialize JSON rather than byte-forwarding it.
Enforce all of the following before any upstream request:

- TLS plus Access Service Auth plus a constant-time gateway-bearer check;
- exact content type and one bounded request body, message count, message size,
  output-token value, attempt deadline, total deadline, concurrency, and
  per-identity request and conservative input-plus-requested-output token budget;
- exact model allowlist matching the three reviewed models and their order;
- roles and fields required by StarGuidance only; reject tools, functions,
  tool-choice, arbitrary response schemas, streaming unless separately
  implemented and tested, caller-supplied URLs, and unknown fields;
- a fixed upstream hostname, HTTPS port, `/openai/v1/chat/completions` path, and
  server-injected Groq credential; and
- bounded upstream response reading with strict JSON validation and generic
  errors that contain no prompt, response, URL, header, or provider body.

Cloudflare rate limiting and WAF rules are defense in depth. Origin-side limits
remain mandatory because edge configuration can drift or be bypassed by an
internal caller.

The blueprint's origin-side buckets are in-memory and single-instance. They
reset on restart and multiply across replicas, so the pilot must not scale the
ingress or egress services beyond one instance. A shared limiter is a separate
production gate.

## Logging and retention

Disable TokenPak prompt/response capture, vault injection, and unnecessary
request telemetry for this instance. Neither Cloudflare, the gateway, TokenPak,
nor the process supervisor should log request or response bodies, authorization
headers, questions, reader-lens traits, or provider errors containing content.
Use opaque request IDs and bounded aggregate latency/status metadata only. The
blueprint does not claim price/cost enforcement; provider-account caps and
alerts remain a separate operations control.

The blueprint sets TokenPak to a one-attempt, no-recovery-persistence policy,
an unwritable monitor database path, disabled compaction/query expansion/term
resolution/caches/vault injection/traces, and an ephemeral bounded home. DLP is
`block`: email, formatted phone, SSN, or secret-like question text can therefore
produce deterministic same-draw fallback. Neither the matching text nor raw
TokenPak error is returned by StarGuidance. Exact settings and smoke tests are
in [the pilot runbook](CALI-TOKENPAK-PILOT.md).

Document a short retention period, verify it on every logging surface, and run
a purge/recovery test. A UI toggle or default is not evidence that historical
capture databases, crash dumps, swap, backups, or rotated service logs are
empty.

## Required pilot evidence

Start with a mock upstream, synthetic non-personal prompts, and no real provider
credential. Record pass/fail evidence for:

1. missing, wrong, expired, and revoked Access credentials and gateway bearer;
2. every forbidden method/path, absolute-form request, and `CONNECT`;
3. unknown/disallowed models, tools/functions, oversized and chunked bodies,
   malformed JSON, excessive messages/output, timeouts, and concurrency;
4. attempted loopback, private, link-local, metadata, internal DNS, redirect,
   and DNS-rebinding egress;
5. absence of host mounts, inherited credentials, privileged capabilities, and
   control-plane sockets;
6. prompt/response absence from application, Access, tunnel, gateway, TokenPak,
   supervisor, crash, and backup logs plus verified purge;
7. deterministic StarGuidance fallback when Access, tunnel, gateway, TokenPak,
   or Groq is unavailable; and
8. independent inspection of the exact image, configuration, identity,
   firewall, egress rules, tunnel route, Access policy, and deployed commit.

CI exercises the complete synthetic HTTP path with a generated Access signing
key and content-blind provider, including response minimization and one-attempt
failure behavior. Those fixtures are CI-only evidence; they do not establish a
live Tunnel, Access policy, Cali host firewall, or provider-retention setting.

Only after that synthetic pilot passes may a separately approved non-production
pilot inject a low-scope Groq key. Any credential known or suspected to have
been exposed must be rotated before public or production use. Production also
requires the per-model safety/grounding, no-retention, redaction, cost, latency,
operations, and legal gates in [Known gaps](KNOWN-GAPS.md).

## Rollback

Set `AI_PROVIDER=disabled` first so new jobs use the deterministic reader. Then
remove the gateway route, revoke the Access service token and gateway bearer,
stop the named tunnel connector, and rotate the Groq key if the isolation
boundary may have failed. Preserve audit evidence; do not delete logs needed for
an incident investigation until the retention owner authorizes it.

## Current references

- [Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Cloudflare Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/)

Cloudflare product behavior and header contracts were rechecked on 2026-08-12.
Retrieve the current documentation and inspect the live account before any
configuration mutation.
