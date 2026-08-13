# Cali TokenPak pilot runbook

## Status and scope

This repository now contains a reviewable **runtime blueprint** in
`infra/cali-tokenpak`; it does not prove that Cali, Cloudflare Access, a named
Tunnel, host egress filtering, or a live TokenPak instance is configured.
Direct Groq remains the deploy-preview default. The blueprint may be used only
for a synthetic, non-production pilot after independent exact-commit approval.

The allowed path is:

```text
StarGuidance server -> Cloudflare Access -> named Tunnel -> ingress gateway
  -> isolated TokenPak -> fixed Groq egress broker -> api.groq.com:443
```

Raw TokenPak is never a tunnel origin. No service in the Compose blueprint
publishes a host port. The named tunnel may reach only `ingress:8787`; the
gateway exposes only `POST /v1/chat/completions` and authenticates both the
Access JWT and a distinct gateway bearer.

The ingress and egress request, token-budget, and concurrency limiters are
intentionally process-local. Run exactly one replica for this pilot; their
counters reset whenever that process restarts. Multiple replicas or durable
production enforcement require a shared, fail-closed limiter before rollout.

## Trust domains

Generate and store each value separately. Do not reuse or copy a value between
rows.

| Secret                   | Held by                            | Purpose and rotation action                                   |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------- |
| named-tunnel token       | `cloudflared` secret only          | Registers the connector; revoke the tunnel token              |
| Access service ID/secret | StarGuidance deploy environment    | Edge service identity; revoke the service token               |
| gateway bearer           | StarGuidance plus `ingress` secret | App-to-origin authentication; replace both copies             |
| TokenPak proxy bearer    | `ingress` plus TokenPak secret     | Authenticates the private proxy hop; replace both copies      |
| TokenPak egress bearer   | TokenPak plus `groq-egress` secret | Authenticates the fixed egress hop; replace both copies       |
| Groq key                 | `groq-egress` secret only          | Provider authorization; rotate in Groq and replace one secret |

Never put these values in Compose YAML, `.env`, shell history, CI output, PR
text, screenshots, or application logs. The previously exposed free-plan Groq
key is acceptable only for the current explicitly non-production direct-Groq
test lane; rotate it before any public or production use.

## Host and Cloudflare prerequisites

Before starting a connector:

1. Use a dedicated, patched Cali workload identity with no interactive-agent,
   repository, home-directory, Docker socket, SSH, credential-store, or cloud
   metadata access.
2. Apply host firewall rules that default-deny container egress. Permit the
   `provider_external` segment only to current `api.groq.com:443` resolutions,
   the `access_external` segment only to the configured
   `<team>.cloudflareaccess.com:443`, and the `tunnel_external` segment only to
   the current Cloudflare Tunnel connector destinations documented by
   Cloudflare. Block loopback, RFC1918, ULA, link-local, metadata, internal DNS,
   and every other destination from those segments. Compose network names are
   segmentation, not an egress firewall.
3. Create one remotely managed **named** Tunnel. Publish one hostname to
   `http://ingress:8787`; do not add catch-all routes, Quick Tunnels, SSH, or
   private-network routes.
4. Create one Cloudflare Access self-hosted application for that exact
   hostname. Use default deny and one Service Auth policy scoped to one service
   token. Record the exact audience in `CLOUDFLARE_ACCESS_AUD`.
5. Confirm Cloudflare Access and Tunnel logs are configured without request
   bodies or authorization headers and with an owner-approved short retention.
6. Keep `AI_PROVIDER_TRANSPORT=direct` and
   `AI_PROVIDER_GATEWAY_APPROVED=false` in StarGuidance until every synthetic
   check and the independent review pass.

Retrieve current Cloudflare Tunnel connectivity endpoints and Access policy
syntax immediately before configuring the live account; do not copy stale IDs
or API fields from this runbook.

## Build and static validation

From `infra/cali-tokenpak`, point each `*_FILE` variable at a file containing a
distinct, generated secret and set the Access team domain/audience. Then run:

```bash
docker compose config --quiet
docker compose build --pull ingress access-jwks tokenpak groq-egress
docker compose run --rm --no-deps --entrypoint python tokenpak /srv/tokenpak/runtime-policy-smoke.py
```

CI also verifies pinned base images, hash-locked TokenPak 1.18.5 installation,
non-root/read-only/capability/resource controls, absence of ports and host
mounts, internal network segmentation, disabled persistence/recovery, and the
real TokenPak DLP HTTP boundary. A CI-only overlay also creates an ephemeral
RSA Access identity and a content-blind mock provider, then proves the live
`ingress -> TokenPak -> egress` success path, credential replacement, canonical
response minimization, and exactly one mock-provider call after a retryable 503.
The mock route and synthetic JWKS hook are absent/default-off in the production
Compose graph. A successful build is necessary but does not prove host firewall
or Cloudflare account configuration.

## Synthetic pilot

Start without a real Groq key. Use the CI-only content-blind mock, which records
only request count, route/host, byte count, opaque request ID, and credential
classification/fingerprint—not the request body.
Use synthetic questions and traits that cannot identify a person.

Record the exact commit and image digests, then prove:

1. missing/wrong/expired/revoked Access identities and gateway bearers fail;
2. all methods and paths except the exact POST fail, including absolute-form,
   CONNECT, upgrade, dashboards, models, sessions, traces, vaults, and metrics;
3. arbitrary prompts/payloads/schemas, tools, streaming, disallowed models,
   malformed/oversized/chunked/slow bodies, and exhausted limits fail;
4. the proxy and egress destinations remain fixed under hostile headers/body;
5. redirects, timeouts, malformed/oversized responses, and failed services
   produce generic errors and deterministic same-draw fallback;
6. no prompt, response, question, trait, credential, provider error, recovery
   preview, monitor database, cache, trace, capsule, or vault artifact appears
   in application, Access, tunnel, container, supervisor, crash, swap, backup,
   or rotated logs; and
7. container escape probes cannot read host homes, the repo, credentials,
   sockets, metadata, or internal services.

## DLP behavior

TokenPak runs DLP in `block` mode. Its current free-tier rules include secret
formats plus email, phone, and SSN-like text. A legitimate tarot question that
contains an email address, formatted phone number, or secret-looking text can
therefore be rejected. StarGuidance treats that as provider failure and returns
the deterministic reading using the already locked cards. It must not retry the
TokenPak request, echo the matched value, expose DLP rule details to the user,
or redraw. The synthetic HTTP smoke test confirms the blocked response does not
echo its email sample.

## One-attempt, no-persistence policy

This instance explicitly sets:

- `TOKENPAK_PROFILE=safe`, with every profile-enabled trace/shadow/budget/cache
  feature overridden off;
- `TOKENPAK_UPSTREAM_RETRIES=1`;
- `TOKENPAK_RETRY_PERSIST_BODY=0`;
- recovery and monitor paths under unwritable `/proc` targets;
- compaction, query expansion/rewriting, term resolution, caches, capsules,
  failure memory, vault injection/indexing, request logging, traces, and
  optimization hooks off; and
- an ephemeral TokenPak home on a bounded `tmpfs`.

The StarGuidance model chain may still make one separately bounded request per
reviewed model using the immutable draw. TokenPak itself does not repeat an
attempt or persist a recovery preview.

The gateway and egress rate/token/concurrency buckets are intentionally local
to one process. The pilot therefore permits one instance only. Restarts reset
the buckets, and replicas would multiply the limits; production scale-out needs
a reviewed shared limiter or equivalently strict upstream enforcement first.

## Low-scope non-production Groq pilot

Only after the synthetic pilot and independent exact-image review pass:

1. inject a rotated low-scope/non-production Groq key into `groq-egress` only;
2. keep the named hostname Access-protected and unavailable to browsers;
3. switch only the non-production preview to `AI_PROVIDER_TRANSPORT=tokenpak`,
   its exact pinned `AI_PROVIDER_GATEWAY_HOST` and `/v1` URL, separated gateway
   and Access credentials, and `AI_PROVIDER_GATEWAY_APPROVED=true`;
4. run same-draw success, all three model fallbacks, DLP block, tunnel outage,
   TokenPak outage, Groq outage, rate/token/concurrency exhaustion, and
   deterministic fallback probes; and
5. re-audit all log and persistence surfaces after the run, then remove the
   provider key unless a named owner approves continued pilot operation.

## Rollback

Set `AI_PROVIDER=disabled` first and verify deterministic readings. Revert the
preview transport to direct Groq only if that lane is still explicitly
approved; otherwise leave it disabled. Then stop `cloudflared`, remove the
hostname route, revoke the Access service token and tunnel token, rotate the
gateway/proxy/egress bearers, stop and remove the disposable containers, and
rotate the Groq key if any boundary may have failed. Preserve incident evidence
under the approved retention policy.

The pilot is complete only when an independent reviewer approves the exact
commit, image digests, Cloudflare resources, host firewall, test receipt, and
post-run absence-of-data evidence. None of that approves production.
