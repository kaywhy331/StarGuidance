import {
  DECK_VERSION,
  spreads,
  TAROT_CONTENT_VERSION,
  tarotCards,
} from "@starguidance/tarot-content";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed reference content");

const sql = postgres(databaseUrl, { max: 1 });
const asJson = (value: unknown): postgres.JSONValue =>
  JSON.parse(JSON.stringify(value)) as postgres.JSONValue;

try {
  await sql.begin(async (transaction) => {
    await transaction`
      insert into decks (version, name)
      values (${DECK_VERSION}, ${"StarGuidance Typographic Tarot"})
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
    for (const spread of spreads) {
      await transaction`
        insert into spreads (id, version, payload)
        values (${spread.id}, ${spread.version}, ${transaction.json(asJson(spread))})
        on conflict (id) do update set version = excluded.version, payload = excluded.payload
      `;
      for (const position of spread.positions) {
        await transaction`
          insert into spread_positions (spread_id, position_id, display_order, payload)
          select ${spread.id}, ${position.id}, ${position.order}, ${transaction.json(asJson(position))}
          where not exists (
            select 1 from spread_positions
            where spread_id = ${spread.id} and position_id = ${position.id}
          )
        `;
      }
    }
    await transaction`
      insert into products (id, name, active)
      values (${"profile-report-v1"}, ${"Detailed Profile Report"}, true)
      on conflict (id) do update set name = excluded.name, active = excluded.active
    `;
    for (const [system, version, status] of [
      ["numerology", "pythagorean-v1", "implemented"],
      ["dreamspell", "dreamspell-anchor-1987-07-26-kin34-v1", "pending-certification"],
      ["westernAstrology", "unavailable", "unavailable"],
      ["bazi", "unavailable", "unavailable"],
    ] as const) {
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
      values (${"deterministic-fallback-v1"}, ${"schema-valid credential-free reading fallback"})
      on conflict (version) do update set purpose = excluded.purpose
    `;
  });
} finally {
  await sql.end();
}
