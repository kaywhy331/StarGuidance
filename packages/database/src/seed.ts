import {
  DECK_VERSION,
  legacySpreads,
  SPREAD_CATALOG_VERSION,
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
      on conflict (version) do nothing
    `;
    const [storedDeck] = await transaction<{ matches: boolean }[]>`
      select name = ${"StarGuidance Typographic Tarot"} as matches
      from decks where version = ${DECK_VERSION}
    `;
    if (!storedDeck?.matches) throw new Error(`SEED_VERSION_CONFLICT:deck:${DECK_VERSION}`);
    for (const card of tarotCards) {
      const cardPayload = asJson(card);
      await transaction`
        insert into cards (id, deck_version, payload)
        values (${card.id}, ${DECK_VERSION}, ${transaction.json(cardPayload)})
        on conflict (id, deck_version) do nothing
      `;
      const [storedCard] = await transaction<{ matches: boolean }[]>`
        select payload = ${transaction.json(cardPayload)} as matches
        from cards where id = ${card.id} and deck_version = ${DECK_VERSION}
      `;
      if (!storedCard?.matches) throw new Error(`SEED_VERSION_CONFLICT:card:${card.id}`);
      const meaningPayload = asJson({
        uprightThemes: card.uprightThemes,
        reversedThemes: card.reversedThemes,
        eventTags: card.eventTags,
        reflectivePrompt: card.reflectivePrompt,
        attribution: card.attribution,
      });
      await transaction`
        insert into card_meanings (card_id, deck_version, content_version, payload)
        select ${card.id}, ${DECK_VERSION}, ${TAROT_CONTENT_VERSION}, ${transaction.json(meaningPayload)}
        where not exists (
          select 1 from card_meanings
          where card_id = ${card.id} and deck_version = ${DECK_VERSION}
            and content_version = ${TAROT_CONTENT_VERSION}
        )
      `;
      const [storedMeaning] = await transaction<{ matches: boolean }[]>`
        select payload = ${transaction.json(meaningPayload)} as matches
        from card_meanings
        where card_id = ${card.id} and deck_version = ${DECK_VERSION}
          and content_version = ${TAROT_CONTENT_VERSION}
      `;
      if (!storedMeaning?.matches)
        throw new Error(`SEED_VERSION_CONFLICT:meaning:${card.id}:${TAROT_CONTENT_VERSION}`);
    }
    const spreadSeeds = [
      ...spreads.map((spread) => ({ spread, active: true })),
      ...legacySpreads.map((spread) => ({ spread, active: false })),
    ];
    for (const { spread, active } of spreadSeeds) {
      const spreadPayload = asJson(spread);
      await transaction`
        insert into spreads (id, version, payload, active)
        values (${spread.id}, ${spread.version}, ${transaction.json(spreadPayload)}, ${active})
        on conflict (id, version) do nothing
      `;
      const [storedSpread] = await transaction<{ matches: boolean }[]>`
        select payload = ${transaction.json(spreadPayload)} as matches
        from spreads where id = ${spread.id} and version = ${spread.version}
      `;
      if (!storedSpread?.matches) throw new Error(`SEED_VERSION_CONFLICT:spread:${spread.id}`);
      for (const position of spread.positions) {
        const positionPayload = asJson(position);
        await transaction`
          insert into spread_positions (spread_id, spread_version, position_id, display_order, payload)
          values (${spread.id}, ${spread.version}, ${position.id}, ${position.order}, ${transaction.json(positionPayload)})
          on conflict (spread_id, spread_version, position_id) do nothing
        `;
        const [storedPosition] = await transaction<{ matches: boolean }[]>`
        select display_order = ${position.order} and payload = ${transaction.json(positionPayload)} as matches
        from spread_positions
          where spread_id = ${spread.id} and spread_version = ${spread.version}
            and position_id = ${position.id}
        `;
        if (!storedPosition?.matches)
          throw new Error(`SEED_VERSION_CONFLICT:position:${spread.id}:${position.id}`);
      }
    }
    await transaction`
      insert into products (id, name, active)
      values (${"profile-report-v1"}, ${"Detailed Profile Report"}, true)
      on conflict (id) do update set name = excluded.name
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
      values
        (${"deck"}, ${DECK_VERSION}),
        (${"cards"}, ${DECK_VERSION}),
        (${"meanings"}, ${TAROT_CONTENT_VERSION}),
        (${"spreads"}, ${SPREAD_CATALOG_VERSION}),
        (${"interpretation-rules"}, ${"interpretation-rules-v1"})
      on conflict (content_type, version) do nothing
    `;
    const promptSeeds = [
      ["deterministic-fallback-v1", "schema-valid credential-free reading fallback"],
      ["reader-voice-v1", "position-aware live reading narrator with minimised trait lens"],
      ["deterministic-fallback-v2", "topic-authoritative credential-free reading fallback"],
      ["reader-voice-v2", "topic-authoritative live reading narrator with minimised trait lens"],
      ["follow-up-reader-voice-v2", "topic-authoritative locked-reading follow-up narrator"],
      ["deterministic-fallback-v3", "narration-first credential-free reading fallback"],
      ["reader-voice-v3", "conversational predictive narrator with minimised private trait lens"],
      [
        "follow-up-reader-voice-v3",
        "conversational continuation of a locked narration-first reading",
      ],
      ["reader-voice-v3-grounded", "reviewed concrete and observable live-reading variant"],
      ["follow-up-reader-voice-v3-grounded", "reviewed concrete continuation variant"],
      [
        "deterministic-fallback-v4",
        "question-first credential-free reader with original spoken card language",
      ],
      [
        "reader-voice-v4",
        "question-first connected live narrator with privacy-safe focus and card progression",
      ],
      ["follow-up-reader-voice-v4", "question-first continuation of a locked connected reading"],
      [
        "reader-voice-v4-grounded",
        "question-first connected live narrator with concrete observable emphasis",
      ],
      [
        "follow-up-reader-voice-v4-grounded",
        "question-first connected continuation with concrete observable emphasis",
      ],
    ] as const;
    for (const [version, purpose] of promptSeeds) {
      await transaction`
        insert into prompt_versions (version, purpose)
        values (${version}, ${purpose})
        on conflict (version) do nothing
      `;
      const [storedPrompt] = await transaction<{ matches: boolean }[]>`
        select purpose = ${purpose} as matches from prompt_versions where version = ${version}
      `;
      if (!storedPrompt?.matches) throw new Error(`SEED_VERSION_CONFLICT:prompt:${version}`);
    }
    const runtimeSeeds = [
      {
        domain: "content",
        payload: {
          deckVersion: DECK_VERSION,
          cardSetVersion: DECK_VERSION,
          tarotContentVersion: TAROT_CONTENT_VERSION,
          spreadCatalogVersion: SPREAD_CATALOG_VERSION,
          interpretationRulesVersion: "interpretation-rules-v1",
          enabledSpreadIds: spreads.map(({ id }) => id),
        },
      },
      {
        domain: "prompts",
        payload: {
          bundleId: "reader-voice-v4",
          safetyPolicyVersion: "question-safety-v2",
        },
      },
      {
        domain: "commerce",
        payload: {
          readingAccessMode: "unlimited",
          freeAllowance: 3,
          allowanceWindowHours: 24,
          followUpLimit: 1,
          rereadCooldownMinutes: 30,
          reportProductId: "profile-report-v1",
          currency: "USD",
          priceMinor: 2900,
        },
      },
      {
        domain: "features",
        payload: {
          profileReportsEnabled: false,
          animationsEnabled: true,
          animationVariant: "immersive-v1",
          enabledProfileSystems: ["numerology", "dreamspell"],
        },
      },
      {
        domain: "models",
        payload: {
          liveAiEnabled: false,
          primaryModel: "openai/gpt-oss-120b",
          fallbackModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
          disabledModels: [],
        },
      },
    ] as const;
    for (const seed of runtimeSeeds)
      await transaction`
        insert into runtime_configuration_versions
          (domain, version, status, payload, approved_at, published_at)
        select ${seed.domain}, 1, 'published', ${transaction.json(asJson(seed.payload))}, now(), now()
        where not exists (
          select 1 from runtime_configuration_versions where domain = ${seed.domain}
        )
      `;
  });
} finally {
  await sql.end();
}
