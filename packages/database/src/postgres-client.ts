import postgres from "postgres";

export type DatabaseClient = postgres.Sql;
export type DatabaseTransaction = postgres.TransactionSql<Record<string, never>>;
export type DatabaseRow = postgres.Row;
export type DatabaseJsonValue = postgres.JSONValue;

export interface DatabaseClientOptions {
  /** Maximum physical connections opened by this process. */
  readonly max?: number;
  /** Seconds before an idle physical connection is released. */
  readonly idleTimeoutSeconds?: number;
  /** Seconds allowed while establishing a physical connection. */
  readonly connectTimeoutSeconds?: number;
}

export function createDatabaseClient(
  databaseUrl: string,
  options: DatabaseClientOptions = {},
): DatabaseClient {
  return postgres(databaseUrl, {
    max: options.max ?? 5,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    prepare: false,
  });
}
