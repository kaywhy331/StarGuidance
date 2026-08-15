import {
  DECK_VERSION,
  legacySpreads,
  spreads,
  TAROT_CONTENT_VERSION,
  tarotCards,
} from "@starguidance/tarot-content";
import postgres from "postgres";

import { REGISTERED_CALCULATION_VERSIONS } from "./calculation-version-registry";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed reference content");

const sql = postgres(databaseUrl, { max: 1 });
const asJson = (value: unknown): postgres.JSONValue =>
  JSON.parse(JSON.stringify(value)) as postgres.JSONValue;

try {
  await sql.begin(async (transaction) => {
    await transaction`
      insert into decks (version, name, active)
      values (${DECK_VERSION}, ${"StarGuidance Typographic Tarot"}, true)
      on conflict (version) do update set name = excluded.name
    `;
    for (const card of tarotCards) {
      await transaction`
        insert into cards (id, deck_version, payload)
        values (${card.id}, ${DECK_VERSION}, ${transaction.json(asJson(card))})
        on conflict (id) do update
        set deck_version = excluded.deck_version, payload = excluded.payload
      `;
      await transaction`
        insert into card_meanings (card_id, content_version, payload)
        select ${card.id}, ${TAROT_CONTENT_VERSION}, ${transaction.json({
          uprightThemes: card.uprightThemes,
          reversedThemes: card.reversedThemes,
          eventTags: card.eventTags,
          reflectivePrompt: card.reflectivePrompt,
          attribution: card.attribution,
        })}
        where not exists (
          select 1 from card_meanings
          where card_id = ${card.id} and content_version = ${TAROT_CONTENT_VERSION}
        )
      `;
    }
    const spreadSeeds = [
      ...spreads.map((spread) => ({ spread, active: true })),
      ...legacySpreads.map((spread) => ({ spread, active: false })),
    ];
    for (const { spread, active } of spreadSeeds) {
      await transaction`
        insert into spreads (id, version, payload, active)
        values (${spread.id}, ${spread.version}, ${transaction.json(asJson(spread))}, ${active})
        on conflict (id) do update
        set version = excluded.version,
            payload = excluded.payload,
            active = case when excluded.active = false then false else spreads.active end
      `;
      for (const position of spread.positions) {
        await transaction`
          insert into spread_positions (spread_id, position_id, display_order, payload)
          values (${spread.id}, ${position.id}, ${position.order}, ${transaction.json(asJson(position))})
          on conflict (spread_id, position_id) do update
          set display_order = excluded.display_order, payload = excluded.payload
        `;
      }
    }
    await transaction`
      insert into products (id, name, active)
      values (${"profile-report-v1"}, ${"Detailed Profile Report"}, true)
      on conflict (id) do update set name = excluded.name, active = excluded.active
    `;
    for (const { system, version, status } of REGISTERED_CALCULATION_VERSIONS) {
      await transaction`
        insert into calculation_versions (system, version, status)
        select ${system}, ${version}, ${status}
        where not exists (
          select 1 from calculation_versions where system = ${system} and version = ${version}
        )
      `;
    }
    await transaction`
      insert into content_versions (content_type, version)
      select ${"tarot"}, ${TAROT_CONTENT_VERSION}
      where not exists (
        select 1 from content_versions
        where content_type = ${"tarot"} and version = ${TAROT_CONTENT_VERSION}
      )
    `;
    await transaction`
      insert into prompt_versions (version, purpose)
      values
        (${"deterministic-fallback-v1"}, ${"schema-valid credential-free reading fallback"}),
        (${"reader-voice-v1"}, ${"position-aware live reading narrator with minimised trait lens"}),
        (${"deterministic-fallback-v2"}, ${"topic-authoritative credential-free reading fallback"}),
        (${"reader-voice-v2"}, ${"topic-authoritative live reading narrator with minimised trait lens"}),
        (${"follow-up-reader-voice-v2"}, ${"topic-authoritative locked-reading follow-up narrator"}),
        (${"deterministic-fallback-v3"}, ${"narration-first credential-free reading fallback"}),
        (${"reader-voice-v3"}, ${"conversational predictive narrator with minimised private trait lens"}),
        (${"follow-up-reader-voice-v3"}, ${"conversational continuation of a locked narration-first reading"})
      on conflict (version) do update set purpose = excluded.purpose
    `;
  });
} finally {
  await sql.end();
}
