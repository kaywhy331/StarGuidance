import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deletionReceiptSubjectHash, recordDeletionReceipt } from "./deletion-receipts";
import { createDatabaseClient } from "./postgres-client";
import { actorTransaction } from "./system-transaction";
import {
  createSubject,
  deleteSubject,
  detectSubjectMode,
  type SubjectMode,
  type SyntheticSubject,
} from "../tests/support/synthetic-subjects";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
const sql = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;

let mode: SubjectMode = "plain";
let subject: SyntheticSubject | undefined;
let userId: string = randomUUID();

describeDatabase("Deletion receipts (migration 0010)", () => {
  beforeAll(async () => {
    if (!sql) return;
    mode = await detectSubjectMode(sql);
    subject = await createSubject(sql, mode, "deletion-receipts");
    userId = subject.id;
    await sql`insert into users (id, email) values (${userId}, ${subject.email})`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from users where id = ${userId}`.catch(() => undefined);
    await sql`delete from deletion_receipts where subject_hash = ${deletionReceiptSubjectHash(userId)}`;
    if (subject) await deleteSubject(sql, mode, subject).catch(() => undefined);
    await sql.end();
  });

  it("lets the actor-bound app role append a receipt it can never read back", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    await actorTransaction(sql, userId, (tx) =>
      recordDeletionReceipt(tx, { userId, policyVersion: "privacy-test-v1" }),
    );
    // Reading, updating, or deleting receipts is withheld from the app role
    // outright — an append-only surface can't be used to enumerate hashes.
    await expect(
      actorTransaction(sql, userId, (tx) => tx`select id from deletion_receipts`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      actorTransaction(
        sql,
        userId,
        (tx) => tx`update deletion_receipts set policy_version = 'forged'`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      actorTransaction(sql, userId, (tx) => tx`delete from deletion_receipts`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps the receipt after the user cascade erases every user-owned row", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    await sql`delete from users where id = ${userId}`;
    const [gone] = await sql`select count(*)::int as count from users where id = ${userId}`;
    expect(gone?.count).toBe(0);
    const receipts = await sql`
      select policy_version from deletion_receipts
      where subject_hash = ${deletionReceiptSubjectHash(userId)}`;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.policy_version).toBe("privacy-test-v1");
  });

  it("is unreachable from the browser-facing authenticated role", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        return tx`select * from deletion_receipts limit 1`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
