import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DECK_VERSION,
  legacySpreads,
  spreads,
  TAROT_CONTENT_VERSION,
  tarotCards,
} from "@starguidance/tarot-content";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient } from "../src/postgres-client";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
const sql = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const execFileAsync = promisify(execFile);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const historicalDeckVersion = "integration-historical-deck-v1";
const historicalContentVersion = "integration-historical-meanings-v1";
const historicalSpreadVersion = "integration-historical-spread-v1";
const currentSpread = spreads[0];

async function cleanupHistoricalRelease(): Promise<void> {
  if (!sql) return;
  await sql`delete from card_meanings where deck_version = ${historicalDeckVersion}`;
  await sql`delete from cards where deck_version = ${historicalDeckVersion}`;
  await sql`delete from decks where version = ${historicalDeckVersion}`;
  await sql`delete from spread_positions where spread_version = ${historicalSpreadVersion}`;
  await sql`delete from spreads where version = ${historicalSpreadVersion}`;
}

describeDatabase("immutable reference-content releases", () => {
  beforeAll(async () => {
    if (!sql || !currentSpread) throw new Error("Reference seed data is required");
    await cleanupHistoricalRelease();

    const [currentCard] = await sql`
      select id from cards where id = 'major-00' and deck_version = ${DECK_VERSION}`;
    const [seededSpread] = await sql`
      select id from spreads where id = ${currentSpread.id} and version = ${currentSpread.version}`;
    if (!currentCard || !seededSpread) throw new Error("Current reference seed data is required");

    await sql.begin(async (transaction) => {
      await transaction`
        insert into decks (version, name, active)
        values (${historicalDeckVersion}, 'Synthetic historical integration deck', false)`;
      await transaction`
        insert into cards (id, deck_version, payload)
        values ('major-00', ${historicalDeckVersion}, ${transaction.json({ release: "historical" })})`;
      await transaction`
        insert into card_meanings (card_id, deck_version, content_version, payload)
        values ('major-00', ${historicalDeckVersion}, ${historicalContentVersion},
          ${transaction.json({ release: "historical" })})`;
      await transaction`
        insert into spreads (id, version, payload, active)
        values (${currentSpread.id}, ${historicalSpreadVersion},
          ${transaction.json({ release: "historical" })}, false)`;
      await transaction`
        insert into spread_positions
          (spread_id, spread_version, position_id, display_order, payload)
        values (${currentSpread.id}, ${historicalSpreadVersion}, 'historical-position', 0,
          ${transaction.json({ release: "historical" })})`;
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await cleanupHistoricalRelease().catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
  });

  it("stores the same canonical card and spread IDs under distinct immutable versions", async () => {
    if (!sql || !currentSpread) throw new Error("DATABASE_INTEGRATION_URL is required");
    const [cards] = await sql<{ count: number }[]>`
      select count(*)::integer as count from cards where id = 'major-00'
        and deck_version in (${DECK_VERSION}, ${historicalDeckVersion})`;
    const [storedSpreads] = await sql<{ count: number }[]>`
      select count(*)::integer as count from spreads where id = ${currentSpread.id}
        and version in (${currentSpread.version}, ${historicalSpreadVersion})`;

    expect(cards?.count).toBe(2);
    expect(storedSpreads?.count).toBe(2);
  });

  it("publishes curated reversal facets under the versioned meaning release", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    const expectedCard = tarotCards.find(({ id }) => id === "major-00");
    const [storedMeaning] = await sql<{ payload: { reversalFacets?: string[] } }[]>`
      select payload from card_meanings
      where card_id = 'major-00'
        and deck_version = ${DECK_VERSION}
        and content_version = ${TAROT_CONTENT_VERSION}`;

    expect(storedMeaning?.payload.reversalFacets).toEqual(expectedCard?.reversalFacets);
  });

  it("activates only current deck and spread releases with matching runtime controls", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    const [activeDeck] = await sql<{ count: number; version: string | null }[]>`
      select count(*)::integer as count, min(version) as version from decks where active`;
    expect(activeDeck).toEqual({ count: 1, version: DECK_VERSION });

    for (const spread of spreads) {
      const [release] = await sql<{ active: boolean }[]>`
        select active from spreads where id = ${spread.id} and version = ${spread.version}`;
      expect(release?.active).toBe(true);
    }
    for (const spread of legacySpreads) {
      const [release] = await sql<{ active: boolean }[]>`
        select active from spreads where id = ${spread.id} and version = ${spread.version}`;
      expect(release?.active).toBe(false);
    }

    const published = await sql<
      { domain: string; version: number; payload: Record<string, unknown> }[]
    >`
      select domain, version, payload from runtime_configuration_versions
      where status = 'published' and domain in ('content', 'prompts') order by domain`;
    expect(published).toEqual([
      expect.objectContaining({
        domain: "content",
        version: 2,
        payload: expect.objectContaining({ deckVersion: DECK_VERSION }),
      }),
      expect.objectContaining({
        domain: "prompts",
        version: 5,
        payload: expect.objectContaining({ bundleId: "reader-voice-v8" }),
      }),
    ]);
  });

  it("reruns the real seed without overwriting or colliding with the historical release", async () => {
    if (!sql || !databaseUrl || !currentSpread)
      throw new Error("DATABASE_INTEGRATION_URL is required");

    await execFileAsync("corepack", ["pnpm", "db:seed"], {
      cwd: repositoryRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 120_000,
    });

    const [historicalCard] = await sql<{ payload: { release?: string } }[]>`
      select payload from cards
      where id = 'major-00' and deck_version = ${historicalDeckVersion}`;
    const [historicalSpread] = await sql<{ payload: { release?: string } }[]>`
      select payload from spreads
      where id = ${currentSpread.id} and version = ${historicalSpreadVersion}`;
    const [currentCard] = await sql`
      select id from cards where id = 'major-00' and deck_version = ${DECK_VERSION}`;
    const [seededSpread] = await sql`
      select id from spreads where id = ${currentSpread.id} and version = ${currentSpread.version}`;

    expect(historicalCard?.payload.release).toBe("historical");
    expect(historicalSpread?.payload.release).toBe("historical");
    expect(currentCard).toBeDefined();
    expect(seededSpread).toBeDefined();
  });
});
