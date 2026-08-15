import postgres from "postgres";

export type DatabaseClient = postgres.Sql;
export type DatabaseTransaction = postgres.TransactionSql<Record<string, never>>;
export type DatabaseRow = postgres.Row;
export type DatabaseJsonValue = postgres.JSONValue;

export function createDatabaseClient(databaseUrl: string): DatabaseClient {
  return postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
}
