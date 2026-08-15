import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../src/postgres-client";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
let sql: DatabaseClient | undefined;
const providerEventId = `evt_${randomUUID()}`;

async function claim(): Promise<boolean> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  const rows = await sql`
    insert into payment_webhook_events (
      provider_event_id, event_type, processing_started_at, attempt_count
    ) values (${providerEventId}, 'checkout.session.completed', now(), 1)
    on conflict (provider_event_id) do update set
      event_type = excluded.event_type,
      processing_started_at = now(),
      attempt_count = payment_webhook_events.attempt_count + 1,
      last_failure_code = null
    where payment_webhook_events.processed_at is null
      and (
        payment_webhook_events.processing_started_at is null
        or payment_webhook_events.processing_started_at < now() - interval '5 minutes'
      )
    returning id`;
  return rows.length === 1;
}

describeDatabase("durable webhook replay lease", () => {
  beforeAll(() => {
    if (!databaseUrl) return;
    sql = createDatabaseClient(databaseUrl);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from payment_webhook_events where provider_event_id = ${providerEventId}`;
    await sql.end();
  });

  it("leases concurrent delivery, releases failure, and permanently deduplicates completion", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);

    await sql`
      update payment_webhook_events
      set processing_started_at = null, last_failure_code = 'processing_failed'
      where provider_event_id = ${providerEventId} and processed_at is null`;
    expect(await claim()).toBe(true);

    await sql`
      update payment_webhook_events
      set processed_at = now(), processing_started_at = null, last_failure_code = null
      where provider_event_id = ${providerEventId}`;
    expect(await claim()).toBe(false);

    const [row] = await sql<
      { attempt_count: number; processed: boolean; last_failure_code: string | null }[]
    >`
      select attempt_count, processed_at is not null as processed, last_failure_code
      from payment_webhook_events where provider_event_id = ${providerEventId}`;
    expect(row).toEqual({ attempt_count: 2, processed: true, last_failure_code: null });
  });

  it("keeps event evidence invisible to the authenticated role", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select * from payment_webhook_events where provider_event_id = ${providerEventId}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
