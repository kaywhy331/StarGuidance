import { describe, expect, it } from "vitest";

import { accessFixtureRefusal, type AccessFixtureEvidence } from "../src/access-fixture-guard";

const root = "/tmp/starguidance-owner-pg-security-abcd1234";

function evidence(): AccessFixtureEvidence {
  return {
    manifest: {
      status: "ready",
      fixture_root: root,
      data_directory: `${root}/data`,
      socket_directory: `${root}/socket`,
      listen_addresses: "",
      postmaster_pid: 4242,
      port: 55434,
      database: "starguidance",
    },
    server: {
      dataDirectory: `${root}/data`,
      listenAddresses: "",
      clientAddress: null,
      port: 55434,
      socketDirectories: `${root}/socket`,
      database: "starguidance",
    },
    postmasterPidLines: ["4242", `${root}/data`, "1", "55434", `${root}/socket`],
  };
}

describe("access fixture guard", () => {
  it("accepts only the matching private security fixture", () => {
    expect(accessFixtureRefusal(evidence())).toBeUndefined();
  });

  it("refuses a bare marker, a shared cluster, TCP, and mismatched identity", () => {
    const refused = (change: (value: AccessFixtureEvidence) => void) => {
      const value = evidence();
      change(value);
      return accessFixtureRefusal(value);
    };
    expect(accessFixtureRefusal({ ...evidence(), manifest: undefined })).toMatch(/missing/);
    expect(
      refused((v) => ((v.manifest as { fixture_root: string }).fixture_root = "/var/lib/pg")),
    ).toMatch(/\/tmp\//);
    expect(
      refused((v) => {
        const m = v.manifest as Record<string, string>;
        m.fixture_root = "/tmp/starguidance-owner-pg-abcd";
        m.data_directory = "/tmp/starguidance-owner-pg-abcd/data";
        m.socket_directory = "/tmp/starguidance-owner-pg-abcd/socket";
      }),
    ).toMatch(/security-\*/);
    expect(refused((v) => (v.server.dataDirectory = "/var/lib/postgresql/17/main"))).toMatch(
      /not the fixture/,
    );
    expect(refused((v) => (v.server.listenAddresses = "*"))).toMatch(/TCP/);
    expect(refused((v) => (v.server.clientAddress = "127.0.0.1"))).toMatch(/Unix socket/);
    expect(refused((v) => (v.server.port = 5432))).toMatch(/port/);
    expect(refused((v) => (v.server.socketDirectories = "/var/run/postgresql"))).toMatch(/socket/);
    expect(refused((v) => (v.server.database = "postgres"))).toMatch(/database/);
    expect(refused((v) => (v.postmasterPidLines = undefined))).toMatch(/unreadable/);
    expect(refused((v) => (v.postmasterPidLines = ["1", `${root}/data`, "1", "55434"]))).toMatch(
      /pid/,
    );
    expect(refused((v) => (v.postmasterPidLines = ["4242", "/other/data", "1", "55434"]))).toMatch(
      /another data directory/,
    );
  });
});
