import { describe, expect, it } from "vitest";

import {
  disposableFixtureRefusal,
  type DisposableFixtureEvidence,
} from "./disposable-postgres-fixture";

const root = "/tmp/starguidance-owner-pg-abc123";
const proven: DisposableFixtureEvidence = {
  manifest: {
    status: "ready",
    fixture_root: root,
    data_directory: `${root}/data`,
    socket_directory: `${root}/socket`,
    listen_addresses: "",
    postmaster_pid: 4242,
    port: 55433,
    database: "starguidance",
  },
  server: {
    dataDirectory: `${root}/data`,
    listenAddresses: "",
    clientAddress: null,
    port: 55433,
    socketDirectories: `${root}/socket`,
    database: "starguidance",
  },
  postmasterPidLines: ["4242", `${root}/data`, "1790000000", "55433", `${root}/socket`, ""],
};

function variant(change: {
  manifest?: Record<string, unknown>;
  server?: Partial<DisposableFixtureEvidence["server"]>;
  postmasterPidLines?: readonly string[] | undefined;
}): DisposableFixtureEvidence {
  return {
    manifest: { ...(proven.manifest as object), ...change.manifest },
    server: { ...proven.server, ...change.server },
    postmasterPidLines:
      "postmasterPidLines" in change ? change.postmasterPidLines : proven.postmasterPidLines,
  };
}

describe("disposable Postgres fixture gate", () => {
  it("accepts only when manifest, connected server, and postmaster.pid agree", () => {
    expect(disposableFixtureRefusal(proven)).toBeUndefined();
  });

  it.each([
    ["no manifest", { ...proven, manifest: undefined }, /manifest is missing/],
    ["a stopped fixture", variant({ manifest: { status: "stopped" } }), /not ready/],
    [
      "a root outside /tmp",
      variant({ manifest: { fixture_root: "/var/lib/postgresql" } }),
      /not a \/tmp/,
    ],
    [
      "a traversal root",
      variant({ manifest: { fixture_root: "/tmp/starguidance-owner-pg-x/../db" } }),
      /normalized/,
    ],
    ["a TCP-enabled manifest", variant({ manifest: { listen_addresses: "*" } }), /TCP listener/],
    [
      "a different (shared or localhost) server",
      variant({ server: { dataDirectory: "/var/lib/postgresql/17/main" } }),
      /not the fixture cluster/,
    ],
    ["a server listening on TCP", variant({ server: { listenAddresses: "localhost" } }), /TCP/],
    ["a TCP connection", variant({ server: { clientAddress: "127.0.0.1" } }), /Unix socket/],
    ["another port, such as 5432", variant({ server: { port: 5432 } }), /port differs/],
    ["another socket", variant({ server: { socketDirectories: "/var/run/postgresql" } }), /socket/],
    ["another database", variant({ server: { database: "postgres" } }), /database differs/],
    ["no postmaster.pid", variant({ postmasterPidLines: undefined }), /unreadable/],
    [
      "a reused or stale pid",
      variant({ postmasterPidLines: ["9999", `${root}/data`, "0", "55433"] }),
      /pid does not match/,
    ],
    [
      "a pid file of another cluster",
      variant({ postmasterPidLines: ["4242", "/elsewhere/data", "0", "55433"] }),
      /another data directory/,
    ],
  ])("refuses %s", (_label, evidence, reason) => {
    expect(disposableFixtureRefusal(evidence)).toMatch(reason);
  });
});
