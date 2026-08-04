import "server-only";

import { isValidEncryptionKey, type ApplicationRepositories } from "@starguidance/database";

import { isLocalRuntimeAdapterAuthorized } from "./hosted-runtime";
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

const MAX_PREVIOUS_ENCRYPTION_KEYS = 3;

function managedEncryptionKeys(): [string, ...string[]] {
  const current = required("DATA_ENCRYPTION_KEY");
  const previous = (process.env.DATA_ENCRYPTION_KEYS_PREVIOUS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (previous.length > MAX_PREVIOUS_ENCRYPTION_KEYS)
    throw new RuntimeConfigurationError(
      `DATA_ENCRYPTION_KEYS_PREVIOUS accepts at most ${MAX_PREVIOUS_ENCRYPTION_KEYS} managed keys.`,
    );
  const keys = [current, ...previous] as [string, ...string[]];
  if (keys.some((key) => !isValidEncryptionKey(key)))
    throw new RuntimeConfigurationError(
      "Every data-encryption key must be canonical base64 for exactly 32 bytes.",
    );
  return [...new Set(keys)] as [string, ...string[]];
}

export function getRuntimeAdapter(): RuntimeAdapter {
  const selected = process.env.RUNTIME_ADAPTER;
  if (selected !== "local" && selected !== "supabase")
    throw new RuntimeConfigurationError(
      "RUNTIME_ADAPTER must explicitly select either local or supabase. No implicit fallback is permitted.",
    );
  if (selected === "local") {
    if (!isLocalRuntimeAdapterAuthorized())
      throw new RuntimeConfigurationError(
        "The local runtime adapter is allowed only when explicitly enabled for local development/test.",
      );
  } else {
    required("NEXT_PUBLIC_SUPABASE_URL");
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    required("DATABASE_URL");
    managedEncryptionKeys();
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

export function getDecryptionKeys(): readonly string[] {
  return getRuntimeAdapter() === "local" ? [localStore.key] : managedEncryptionKeys();
}
