import "server-only";

import type { ApplicationRepositories } from "@starguidance/database";

import { localStore } from "./local-store";
import { createLocalRepositories } from "./repositories/local";
import { createPostgresRepositories } from "./repositories/postgres";

export type RuntimeAdapter = "local" | "supabase";

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new RuntimeConfigurationError(`${name} is required by the selected runtime adapter.`);
  return value;
}

export function getRuntimeAdapter(): RuntimeAdapter {
  const selected = process.env.RUNTIME_ADAPTER;
  if (selected !== "local" && selected !== "supabase")
    throw new RuntimeConfigurationError(
      "RUNTIME_ADAPTER must explicitly select either local or supabase. No implicit fallback is permitted.",
    );
  if (selected === "local") {
    const localEnvironment =
      process.env.APP_ENV === "development" || process.env.APP_ENV === "test";
    const netlifyContext = process.env.CONTEXT;
    if (
      process.env.ALLOW_LOCAL_RUNTIME_ADAPTER !== "true" ||
      !localEnvironment ||
      (netlifyContext !== undefined && netlifyContext !== "dev")
    )
      throw new RuntimeConfigurationError(
        "The local runtime adapter is allowed only when explicitly enabled for local development/test.",
      );
  } else {
    required("NEXT_PUBLIC_SUPABASE_URL");
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    required("DATABASE_URL");
    const key = Buffer.from(required("DATA_ENCRYPTION_KEY"), "base64");
    if (key.length !== 32)
      throw new RuntimeConfigurationError(
        "DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte managed secret.",
      );
  }
  return selected;
}

export function getRepositoriesForUser(userId: string): ApplicationRepositories {
  return getRuntimeAdapter() === "local"
    ? createLocalRepositories()
    : createPostgresRepositories({ databaseUrl: required("DATABASE_URL"), actorUserId: userId });
}

export function getServiceRepositories(): ApplicationRepositories {
  return getRuntimeAdapter() === "local"
    ? createLocalRepositories()
    : createPostgresRepositories({ databaseUrl: required("DATABASE_URL"), serviceRole: true });
}

export function getEncryptionKey(): string {
  return getRuntimeAdapter() === "local" ? localStore.key : required("DATA_ENCRYPTION_KEY");
}
