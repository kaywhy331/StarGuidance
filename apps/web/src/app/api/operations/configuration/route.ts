import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { OPERATIONAL_ACCESS_DENIED, requireOperationalRole } from "@/lib/operational-access";
import {
  defaultRuntimeConfiguration,
  getRuntimeConfiguration,
  modelConfigurationSchema,
  parseRuntimeConfigurationPayload,
  RUNTIME_CONFIGURATION_DOMAINS,
  type RuntimeConfigurationDomain,
} from "@/lib/runtime-configuration";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter, getSystemDatabaseClient } from "@/lib/runtime";

const configurationId = z.string().uuid();
const safeTarget = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/i);

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-draft"),
    domain: z.enum(RUNTIME_CONFIGURATION_DOMAINS),
    payload: z.unknown(),
  }),
  z.object({ action: z.literal("approve"), configurationId }),
  z.object({ action: z.literal("publish"), configurationId }),
  z.object({
    action: z.literal("rollback"),
    domain: z.enum(RUNTIME_CONFIGURATION_DOMAINS),
    targetVersion: z.number().int().positive(),
    confirmation: z.literal("ROLL BACK"),
  }),
  z.object({
    action: z.literal("set-content-active"),
    targetType: z.enum(["spread", "deck", "product"]),
    targetId: safeTarget,
    active: z.boolean(),
    confirmation: z.literal("APPLY"),
  }),
  z.object({
    action: z.literal("kill-switch"),
    targetType: z.enum(["ai", "model", "payments"]),
    targetId: safeTarget.optional(),
    confirmation: z.literal("DISABLE NOW"),
  }),
]);

interface ConfigurationRow {
  id: string;
  domain: RuntimeConfigurationDomain;
  version: number;
  status: "draft" | "approved" | "published" | "archived";
  payload: unknown;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  published_at: Date | null;
  created_at: Date;
}

function operationalError(error: unknown): Response | undefined {
  if (error instanceof Error && error.message === "UNAUTHENTICATED")
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (error instanceof Error && error.message === OPERATIONAL_ACCESS_DENIED)
    return NextResponse.json({ error: "Operational access denied." }, { status: 403 });
  if (error instanceof Error && error.message === "OPERATIONAL_ACCESS_MISCONFIGURED")
    return NextResponse.json(
      { error: "Operational access is not configured safely." },
      { status: 503 },
    );
  return undefined;
}

async function configurationRows(): Promise<ConfigurationRow[]> {
  return getSystemDatabaseClient()<ConfigurationRow[]>`
    select id, domain, version, status, payload, created_by, approved_by,
           approved_at, published_at, created_at
    from runtime_configuration_versions
    order by domain, version desc
  `;
}

export async function GET() {
  try {
    const user = await requireOperationalRole("operator", await requireUser());
    if (getRuntimeAdapter() !== "supabase")
      return NextResponse.json(
        { error: "Runtime publishing requires the durable database adapter." },
        { status: 503 },
      );
    const client = getSystemDatabaseClient();
    const [versions, effective, contentRows] = await Promise.all([
      configurationRows(),
      getRuntimeConfiguration(),
      client<{ target_type: "deck" | "spread" | "product"; id: string; active: boolean }[]>`
        select 'deck'::text as target_type, version as id, active from decks
        union all
        select 'spread'::text, id, active from spreads
        union all
        select 'product'::text, id, active from products
        order by target_type, id
      `,
    ]);
    return NextResponse.json({
      effective,
      versions: versions.map((version) => ({
        id: version.id,
        domain: version.domain,
        version: version.version,
        status: version.status,
        payload: version.payload,
        createdByCurrentOperator: version.created_by === user.id,
        approvedByCurrentOperator: version.approved_by === user.id,
        approvedAt: version.approved_at?.toISOString() ?? null,
        publishedAt: version.published_at?.toISOString() ?? null,
        createdAt: version.created_at.toISOString(),
      })),
      content: contentRows.map((row) => ({
        targetType: row.target_type,
        id: row.id,
        active: row.active,
      })),
      approvalPolicy: "A second operator must approve every draft before publication.",
    });
  } catch (error) {
    const response = operationalError(error);
    if (response) return response;
    return NextResponse.json(
      { error: "Runtime configuration could not be loaded." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireOperationalRole("operator", await requireUser());
    await assertRateLimit(`operations-configuration:${user.id}`, 30, 60 * 60_000);
    if (getRuntimeAdapter() !== "supabase")
      return NextResponse.json(
        { error: "Runtime publishing requires the durable database adapter." },
        { status: 503 },
      );
    const input = actionSchema.parse(await request.json());
    const client = getSystemDatabaseClient();

    if (input.action === "create-draft") {
      const payload = parseRuntimeConfigurationPayload(input.domain, input.payload);
      const created = await client.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext(${input.domain}))`;
        const [next] = await transaction<{ version: number }[]>`
          select coalesce(max(version), 0)::integer + 1 as version
          from runtime_configuration_versions where domain = ${input.domain}
        `;
        const [row] = await transaction<{ id: string; version: number }[]>`
          insert into runtime_configuration_versions (domain, version, status, payload, created_by)
          values (${input.domain}, ${next?.version ?? 1}, 'draft', ${transaction.json(payload)}, ${user.id})
          returning id, version
        `;
        if (!row) throw new Error("RUNTIME_CONFIGURATION_WRITE_FAILED");
        await transaction`
          insert into audit_events (user_id, action, target_type, target_id, metadata)
          values (${user.id}, 'operations.configuration.draft_created', 'runtime-configuration', ${row.id},
            ${transaction.json({ domain: input.domain, version: row.version })})
        `;
        return row;
      });
      return NextResponse.json({ created: true, ...created }, { status: 201 });
    }

    if (input.action === "approve") {
      const approved = await client.begin(async (transaction) => {
        const [row] = await transaction<ConfigurationRow[]>`
          select * from runtime_configuration_versions where id = ${input.configurationId} for update
        `;
        if (!row || row.status !== "draft") return false;
        if (row.created_by === user.id) throw new Error("RUNTIME_CONFIGURATION_SELF_APPROVAL");
        await transaction`
          update runtime_configuration_versions
          set status = 'approved', approved_by = ${user.id}, approved_at = now()
          where id = ${row.id}
        `;
        await transaction`
          insert into audit_events (user_id, action, target_type, target_id, metadata)
          values (${user.id}, 'operations.configuration.approved', 'runtime-configuration', ${row.id},
            ${transaction.json({ domain: row.domain, version: row.version })})
        `;
        return true;
      });
      if (!approved)
        return NextResponse.json(
          { error: "Only an existing draft can be approved." },
          { status: 409 },
        );
      return NextResponse.json({ approved: true });
    }

    if (input.action === "publish") {
      const published = await client.begin(async (transaction) => {
        const [row] = await transaction<ConfigurationRow[]>`
          select * from runtime_configuration_versions where id = ${input.configurationId} for update
        `;
        if (!row || row.status !== "approved" || !row.approved_by) return false;
        // A draft can outlive an application deploy. Revalidate its closed
        // payload against the currently running code and model allowlist before
        // it is allowed to become the effective release.
        parseRuntimeConfigurationPayload(row.domain, row.payload);
        await transaction`select pg_advisory_xact_lock(hashtext(${row.domain}))`;
        await transaction`
          update runtime_configuration_versions set status = 'archived'
          where domain = ${row.domain} and status = 'published'
        `;
        await transaction`
          update runtime_configuration_versions set status = 'published', published_at = now()
          where id = ${row.id}
        `;
        await transaction`
          insert into audit_events (user_id, action, target_type, target_id, metadata)
          values (${user.id}, 'operations.configuration.published', 'runtime-configuration', ${row.id},
            ${transaction.json({ domain: row.domain, version: row.version })})
        `;
        return true;
      });
      if (!published)
        return NextResponse.json(
          { error: "Only a separately approved draft can be published." },
          { status: 409 },
        );
      return NextResponse.json({ published: true });
    }

    if (input.action === "rollback") {
      const rolledBack = await client.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext(${input.domain}))`;
        const [target] = await transaction<ConfigurationRow[]>`
          select * from runtime_configuration_versions
          where domain = ${input.domain} and version = ${input.targetVersion} for update
        `;
        const bootstrappedApprovedRelease =
          target?.created_by === null && target.approved_at !== null;
        if (
          !target ||
          (!target.approved_by && !bootstrappedApprovedRelease) ||
          target.status === "draft"
        )
          return false;
        // Archived releases are immutable, but code support and the model
        // allowlist can legitimately narrow over time. Never reactivate a
        // payload the current deployment can no longer interpret safely.
        parseRuntimeConfigurationPayload(target.domain, target.payload);
        await transaction`
          update runtime_configuration_versions set status = 'archived'
          where domain = ${input.domain} and status = 'published'
        `;
        await transaction`
          update runtime_configuration_versions set status = 'published', published_at = now()
          where id = ${target.id}
        `;
        await transaction`
          insert into audit_events (user_id, action, target_type, target_id, metadata)
          values (${user.id}, 'operations.configuration.rolled_back', 'runtime-configuration', ${target.id},
            ${transaction.json({ domain: input.domain, version: input.targetVersion })})
        `;
        return true;
      });
      if (!rolledBack)
        return NextResponse.json(
          { error: "That approved configuration version is unavailable." },
          { status: 409 },
        );
      return NextResponse.json({ rolledBack: true });
    }

    if (input.action === "set-content-active") {
      const table =
        input.targetType === "spread"
          ? "spreads"
          : input.targetType === "deck"
            ? "decks"
            : "products";
      const column = input.targetType === "deck" ? "version" : "id";
      const changed = await client.begin(async (transaction) => {
        const rows = await transaction.unsafe<{ id: string }[]>(
          `update ${table} set active = $1 where ${column} = $2 returning ${column} as id`,
          [input.active, input.targetId],
        );
        if (!rows[0]) return false;
        await transaction`
          insert into audit_events (user_id, action, target_type, target_id, metadata)
          values (${user.id}, 'operations.content.activation_changed', ${input.targetType}, ${input.targetId},
            ${transaction.json({ active: input.active })})
        `;
        return true;
      });
      if (!changed)
        return NextResponse.json({ error: "That content target does not exist." }, { status: 404 });
      return NextResponse.json({ changed: true, active: input.active });
    }

    const domain: RuntimeConfigurationDomain =
      input.targetType === "payments" ? "features" : "models";
    const current = await getRuntimeConfiguration().catch(() => defaultRuntimeConfiguration());
    const payload =
      input.targetType === "payments"
        ? { ...current.features, profileReportsEnabled: false }
        : modelConfigurationSchema.parse({
            ...current.models,
            ...(input.targetType === "ai" ? { liveAiEnabled: false } : {}),
            ...(input.targetType === "model" && input.targetId
              ? { disabledModels: [...new Set([...current.models.disabledModels, input.targetId])] }
              : {}),
          });
    const emergency = await client.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${domain}))`;
      const [next] = await transaction<{ version: number }[]>`
        select coalesce(max(version), 0)::integer + 1 as version
        from runtime_configuration_versions where domain = ${domain}
      `;
      await transaction`
        update runtime_configuration_versions set status = 'archived'
        where domain = ${domain} and status = 'published'
      `;
      const [row] = await transaction<{ id: string; version: number }[]>`
        insert into runtime_configuration_versions
          (domain, version, status, payload, approved_by, approved_at, published_at)
        values (${domain}, ${next?.version ?? 1}, 'published', ${transaction.json(payload)},
          ${user.id}, now(), now())
        returning id, version
      `;
      if (!row) throw new Error("RUNTIME_CONFIGURATION_WRITE_FAILED");
      await transaction`
        insert into audit_events (user_id, action, target_type, target_id, metadata)
        values (${user.id}, 'operations.kill_switch.activated', ${input.targetType},
          ${input.targetId ?? input.targetType}, ${transaction.json({ domain, version: row.version })})
      `;
      return row;
    });
    return NextResponse.json({ disabled: true, ...emergency });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    const response = operationalError(error);
    if (response) return response;
    if (
      error instanceof z.ZodError ||
      (error instanceof Error && error.message === "RUNTIME_MODEL_NOT_APPROVED")
    )
      return NextResponse.json(
        { error: "The configuration payload is not approved or valid." },
        { status: 422 },
      );
    if (error instanceof Error && error.message === "RUNTIME_CONFIGURATION_SELF_APPROVAL")
      return NextResponse.json(
        { error: "A second operator must approve this draft." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "The configuration action could not be completed." },
      { status: 500 },
    );
  }
}
