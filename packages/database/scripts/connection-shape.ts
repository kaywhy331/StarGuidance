/**
 * Non-secret description of a Postgres connection string.
 *
 * Only categories are derived — never the host, user, password, or database
 * name — so the result is safe to record in published evidence.
 */
export interface ConnectionShape {
  /** 5432 is a direct/session connection; 6543 is Supabase's transaction pooler. */
  readonly port: number;
  /** Supabase transaction pooling rejects prepared statements and some DDL. */
  readonly likelyTransactionPooler: boolean;
  /** Supabase's `*.pooler.supabase.com` session/transaction endpoints. */
  readonly likelyPoolerHost: boolean;
  /** Direct `db.*.supabase.co` hosts are commonly IPv6-only. */
  readonly likelyDirectSupabaseHost: boolean;
  readonly sslModeRequested: string | undefined;
  readonly hasUsername: boolean;
  readonly hasPassword: boolean;
  readonly hasDatabaseName: boolean;
}

/**
 * Driver errors quote the host they failed to reach, which would carry the
 * project reference into published evidence. Strip anything host-shaped.
 */
export function scrubHosts(message: string): string {
  return message.replace(/\b[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g, "[host]");
}

export function describeConnection(databaseUrl: string): ConnectionShape {
  const url = new URL(databaseUrl);
  const port = Number(url.port || "5432");
  const host = url.hostname.toLowerCase();
  return {
    port,
    likelyTransactionPooler: port === 6543,
    likelyPoolerHost: host.includes(".pooler.supabase.com"),
    likelyDirectSupabaseHost: host.startsWith("db.") && host.endsWith(".supabase.co"),
    sslModeRequested: url.searchParams.get("sslmode") ?? undefined,
    hasUsername: url.username.length > 0,
    hasPassword: url.password.length > 0,
    hasDatabaseName: url.pathname.replace(/^\//, "").length > 0,
  };
}

/** Operator-facing guidance derived only from the non-secret shape. */
export function connectionAdvice(shape: ConnectionShape): string[] {
  const advice: string[] = [];
  if (shape.likelyTransactionPooler)
    advice.push(
      "port 6543 is Supabase's transaction pooler; it rejects prepared statements and is not " +
        "a supported target for schema migrations. Use the session pooler on 5432 instead.",
    );
  if (shape.likelyDirectSupabaseHost)
    advice.push(
      "a direct Supabase database host is commonly IPv6-only, which GitHub-hosted runners " +
        "cannot reach; the IPv4-reachable session pooler is usually required from CI.",
    );
  if (!shape.hasPassword) advice.push("the connection string carries no password component");
  if (!shape.hasDatabaseName) advice.push("the connection string names no database");
  return advice;
}
