import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("./compose.yaml", import.meta.url), "utf8");
const composeCi = readFileSync(new URL("./compose.ci.yaml", import.meta.url), "utf8");
const tokenpakConfig = readFileSync(new URL("./tokenpak/config.yaml", import.meta.url), "utf8");
const tokenpakEntrypoint = readFileSync(
  new URL("./tokenpak/entrypoint.sh", import.meta.url),
  "utf8",
);
const tokenpakRuntimePolicy = readFileSync(
  new URL("./tokenpak/runtime-policy-smoke.py", import.meta.url),
  "utf8",
);
const runtimeIngressSmoke = readFileSync(
  new URL("./runtime-ingress-smoke.mjs", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const runtimeDockerfile = readFileSync(new URL("./runtime.Dockerfile", import.meta.url), "utf8");
const tokenpakDockerfile = readFileSync(new URL("./tokenpak/Dockerfile", import.meta.url), "utf8");
const tokenpakDockerignore = readFileSync(
  new URL("./tokenpak/.dockerignore", import.meta.url),
  "utf8",
);

function serviceBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = compose.match(
    new RegExp(`^  ${escaped}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|^networks:)`, "m"),
  );
  if (!match) throw new Error(`Missing service ${name}`);
  return match[0];
}

describe("Cali TokenPak Compose isolation", () => {
  it("has no published ports, host mounts, host namespaces, or privileged workload", () => {
    expect(compose).not.toMatch(/^\s+(?:ports|volumes):/m);
    expect(compose).not.toMatch(/^\s+(?:network_mode|pid|ipc):\s*host\s*$/m);
    expect(compose).not.toMatch(/^\s+privileged:\s*true\s*$/m);
    expect(compose).not.toContain("/var/run/docker.sock");
    expect(compose).not.toContain("/run/containerd/");
  });

  it.each(["ingress", "access-jwks", "tokenpak", "groq-egress", "cloudflared"])(
    "hardens the %s runtime",
    (service) => {
      const block = serviceBlock(service);
      expect(block).toContain("read_only: true");
      expect(block).toContain('user: "65532:65532"');
      expect(block).toContain('cap_drop: ["ALL"]');
      expect(block).toContain('security_opt: ["no-new-privileges:true"]');
      expect(block).toMatch(/pids_limit: \d+/);
      expect(block).toMatch(/mem_limit: \d+m/);
      expect(block).toMatch(/cpus: \d+\.\d+/);
      expect(block).toContain("init: true");
      expect(block).toContain("tmpfs:");
    },
  );

  it("segments ingress, proxy, and each outbound trust domain", () => {
    expect(serviceBlock("ingress")).toContain("- tunnel_edge\n      - ingress_proxy");
    expect(serviceBlock("tokenpak")).toContain("- ingress_proxy\n      - proxy_egress");
    expect(serviceBlock("groq-egress")).toContain("- proxy_egress\n      - provider_external");
    expect(serviceBlock("access-jwks")).toContain("- ingress_proxy\n      - access_external");
    expect(serviceBlock("cloudflared")).toContain("- tunnel_edge\n      - tunnel_external");
    for (const name of ["tunnel_edge", "ingress_proxy", "proxy_egress"])
      expect(compose).toContain(`  ${name}:\n    internal: true`);
  });

  it("pins every base image and installs TokenPak from a hash-locked manifest", () => {
    expect(runtimeDockerfile).toMatch(/^FROM [^\s]+@sha256:[a-f0-9]{64}$/m);
    expect(tokenpakDockerfile).toMatch(/^FROM [^\s]+@sha256:[a-f0-9]{64}$/m);
    expect(serviceBlock("cloudflared")).toMatch(/image: [^\s]+@sha256:[a-f0-9]{64}/);
    expect(tokenpakDockerfile).toContain("pip install --no-cache-dir --require-hashes");
  });

  it("keeps mock routing entirely outside the production Compose graph", () => {
    expect(compose).not.toContain("mock-groq");
    expect(compose).not.toContain("GROQ_ENDPOINT");
    expect(composeCi).toContain("mock-groq:");
    expect(composeCi).toContain('command: ["node", "/app/egress-ci.mjs"]');
    expect(composeCi).toContain("ci_provider:");
    expect(composeCi).toContain("internal: true");
    expect(composeCi).toContain("CI_ACCESS_JWKS");
    expect(composeCi).toContain("ci-client:");
    expect(composeCi).toContain('command: ["sleep", "2147483647"]');
    expect(composeCi).not.toContain("setInterval(()=>{}, 60000)");
    expect(composeCi).toContain('/app/access-jwks-ci.mjs"');
  });

  it("probes success and upstream failure through the same authenticated ingress", () => {
    const expectedRequestIdentifiers = [
      "ci-chain-ingress-success-12345678",
      "ci-chain-forced-failure-12345678",
    ];
    const requestIdentifierPattern = /ci-chain-[a-z-]+-12345678/g;

    expect(runtimeIngressSmoke).toContain('["success", "forced-failure"]');
    expect(runtimeIngressSmoke).toContain('code: "UPSTREAM_REJECTED"');
    expect(ciWorkflow).toContain("runtime-ingress-smoke.mjs success");
    expect(ciWorkflow).toContain("runtime-ingress-smoke.mjs forced-failure");
    expect(new Set(runtimeIngressSmoke.match(requestIdentifierPattern))).toEqual(
      new Set(expectedRequestIdentifiers),
    );
    expect(new Set(ciWorkflow.match(requestIdentifierPattern))).toEqual(
      new Set(expectedRequestIdentifiers),
    );
    expect(ciWorkflow).not.toContain("runtime-chain-request.py");
  });

  it("includes every copied TokenPak runtime smoke in its allowlist build context", () => {
    for (const file of ["runtime-policy-smoke.py", "runtime-http-smoke.py"]) {
      expect(tokenpakDockerfile).toContain(`COPY ${file}`);
      expect(tokenpakDockerignore).toContain(`!${file}`);
    }
    expect(tokenpakDockerfile).not.toContain("runtime-chain-request.py");
    expect(tokenpakDockerignore).not.toContain("runtime-chain-request.py");
  });

  it("pins the fail-closed TokenPak privacy and retry policy", () => {
    const tokenpak = serviceBlock("tokenpak");
    for (const setting of [
      "TOKENPAK_PROFILE: safe",
      'TOKENPAK_UPSTREAM_RETRIES: "1"',
      "TOKENPAK_UPSTREAM_RECOVERY_DIR: /proc/tokenpak-recovery-disabled",
      'TOKENPAK_RETRY_PERSIST_BODY: "0"',
      'TOKENPAK_COMPACT: "0"',
      'TOKENPAK_QUERY_EXPANSION_ENABLED: "0"',
      'TOKENPAK_TERM_RESOLVER_ENABLED: "0"',
      'TOKENPAK_REQUEST_LOGGER: "0"',
      'TOKENPAK_TRACE: "0"',
      'TOKENPAK_VAULT_INJECTION: "0"',
      "TOKENPAK_DLP_MODE: block",
      "HOME: /proc/tokenpak-home-disabled",
      "TOKENPAK_HOME: /proc/tokenpak-home-disabled",
      "TOKENPAK_DB: /proc/tokenpak-monitor-disabled.db",
    ])
      expect(tokenpak).toContain(setting);
    expect(tokenpak).not.toContain("/var/lib/tokenpak");
    expect(tokenpakDockerfile).toContain("HOME=/proc/tokenpak-home-disabled");
    expect(tokenpakDockerfile).toContain("TOKENPAK_HOME=/proc/tokenpak-home-disabled");
    expect(tokenpakConfig).toContain("include_request_body: false");
    expect(tokenpakConfig).toContain("include_response_body: false");
    expect(tokenpakConfig).toContain("retention_days: 0");
    expect(tokenpakEntrypoint).toContain("unsafe TokenPak runtime setting");
    expect(tokenpakEntrypoint).toContain("HOME=/proc/tokenpak-home-disabled");
    expect(tokenpakEntrypoint).toContain("TOKENPAK_HOME=/proc/tokenpak-home-disabled");
    expect(tokenpakEntrypoint).toContain("from tokenpak.proxy.server import start_proxy");
    expect(tokenpakEntrypoint).not.toContain("python -m tokenpak.proxy.server");
    expect(tokenpakRuntimePolicy).toContain("assert proxy.monitor is None");
    expect(tokenpakRuntimePolicy).toContain(
      '"/proc/tokenpak-home-disabled/compression_events.jsonl"',
    );
  });
});
