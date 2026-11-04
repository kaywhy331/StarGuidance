import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ApplicationCreatorRefusedError,
  migrateAsApplicationCreator,
} from "../src/guarded-migrate";
import type { DatabaseClient } from "../src/postgres-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Records every statement the entrypoint would send; answers only the identity query. */
function recordingClient(identity: { sessionUser: string; currentUser: string }) {
  const statements: string[] = [];
  const client = ((strings: TemplateStringsArray) => {
    statements.push(strings.join("?"));
    return Promise.resolve([identity]);
  }) as unknown as DatabaseClient;
  return { client, statements };
}

describe("guarded application migration entrypoint", () => {
  it("is what pnpm db:migrate runs, not a bare drizzle-kit migrate", () => {
    const scripts = (
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["db:migrate"]).toBe("tsx packages/database/scripts/migrate.ts");
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(/drizzle-kit\s+migrate/);
    }
    const entry = readFileSync(join(root, "packages/database/scripts/migrate.ts"), "utf8");
    expect(entry).toMatch(/migrateAsApplicationCreator/);
    expect(entry).not.toMatch(/drizzle-kit/);
  });

  it("is the only migration operation in the normal CI and staging workflows", () => {
    for (const file of ["ci.yml", "staging-verify.yml"]) {
      const workflow = readFileSync(join(root, ".github", "workflows", file), "utf8");
      expect(workflow, file).not.toMatch(/drizzle-kit\s+migrate/);
      expect(workflow, file).toMatch(/pnpm db:migrate/);
    }
  });

  it("refuses before issuing any statement other than the identity read", async () => {
    for (const identity of [
      { sessionUser: "alt", currentUser: "alt" },
      { sessionUser: "alt", currentUser: "postgres" },
      { sessionUser: "postgres", currentUser: "alt" },
    ]) {
      const { client, statements } = recordingClient(identity);
      await expect(migrateAsApplicationCreator(client, "/nonexistent")).rejects.toBeInstanceOf(
        ApplicationCreatorRefusedError,
      );
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/session_user/);
    }
  });
});
