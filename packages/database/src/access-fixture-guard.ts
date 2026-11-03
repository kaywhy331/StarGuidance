import { posix } from "node:path";

/**
 * Gate for privilege tests that create cluster-wide roles and databases. An
 * environment marker or a local socket is not enough: the manifest, the server
 * the test is actually connected to, and that cluster's own postmaster.pid must
 * all name the same private, socket-only /tmp/starguidance-owner-pg-security-*
 * cluster.
 */
export interface AccessFixtureEvidence {
  /** Parsed manifest named by STARGUIDANCE_DISPOSABLE_POSTGRES_FIXTURE. */
  manifest: unknown;
  /** Facts reported by the connected server itself. */
  server: {
    dataDirectory: string;
    listenAddresses: string;
    clientAddress: string | null;
    port: number;
    socketDirectories: string;
    database: string;
  };
  /** Lines of <data_directory>/postmaster.pid, or undefined when unreadable. */
  postmasterPidLines: readonly string[] | undefined;
}

const FIXTURE_PREFIX = "starguidance-owner-pg-security-";

/** Returns why role/database writes are refused, or undefined when proven disposable. */
export function accessFixtureRefusal({
  manifest,
  server,
  postmasterPidLines,
}: AccessFixtureEvidence): string | undefined {
  if (!manifest || typeof manifest !== "object") return "fixture manifest is missing";
  const fixture = manifest as Record<string, unknown>;
  if (fixture.status !== "ready") return "fixture manifest is not ready";
  const root = fixture.fixture_root;
  if (typeof root !== "string" || posix.normalize(root) !== root)
    return "fixture root is not a normalized path";
  if (posix.dirname(root) !== "/tmp" || !posix.basename(root).startsWith(FIXTURE_PREFIX))
    return `fixture root is not a /tmp/${FIXTURE_PREFIX}* directory`;
  if (fixture.data_directory !== `${root}/data`)
    return "fixture data directory is outside its root";
  if (fixture.socket_directory !== `${root}/socket`) return "fixture socket is outside its root";
  if (fixture.listen_addresses !== "") return "fixture manifest allows a TCP listener";
  if (!Number.isInteger(fixture.postmaster_pid) || !Number.isInteger(fixture.port))
    return "fixture manifest lacks postmaster pid or port";

  if (server.dataDirectory !== fixture.data_directory)
    return "connected server is not the fixture cluster";
  if (server.listenAddresses !== "") return "connected server listens on TCP";
  if (server.clientAddress !== null) return "connection is not over the private Unix socket";
  if (server.port !== fixture.port) return "connected server port differs from the fixture";
  if (
    !server.socketDirectories
      .split(",")
      .map((dir) => dir.trim())
      .includes(`${root}/socket`)
  )
    return "connected server does not use the fixture socket";
  if (server.database !== fixture.database) return "connected database differs from the fixture";

  if (!postmasterPidLines) return "fixture postmaster.pid is unreadable";
  const [pid, dataDirectory, , port] = postmasterPidLines;
  if (Number(pid) !== fixture.postmaster_pid) return "fixture postmaster pid does not match";
  if (dataDirectory !== fixture.data_directory)
    return "postmaster.pid names another data directory";
  if (Number(port) !== fixture.port) return "postmaster.pid names another port";
  return undefined;
}
