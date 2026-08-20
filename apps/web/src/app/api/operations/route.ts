import { randomUUID } from "node:crypto";
import {
  inspectJobQueues,
  reenqueueInterpretationJob,
  reenqueueReportJob,
} from "@starguidance/database";
import { z } from "zod";
import { configuredAiProviderRoute, createInterpretationProvider } from "@starguidance/ai";

import { requireUser } from "@/lib/auth";
import { OPERATIONAL_ACCESS_DENIED, requireOperationalRole } from "@/lib/operational-access";
import { tryRecordProductEvent } from "@/lib/product-telemetry";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter, getSystemDatabaseClient } from "@/lib/runtime";
import {
  getRuntimeConfiguration,
  interpretationRuntimeOptions,
  profileReportsEnabled,
} from "@/lib/runtime-configuration";

const traceIdSchema = z.string().uuid();
const retrySchema = z.object({
  action: z.literal("retry-job"),
  queue: z.enum(["interpretation", "report"]),
  targetId: z.string().uuid(),
});

function operationalError(error: unknown): Response | undefined {
  if (error instanceof Error && error.message === "UNAUTHENTICATED")
    return Response.json({ error: "Authentication required." }, { status: 401 });
  if (error instanceof Error && error.message === OPERATIONAL_ACCESS_DENIED)
    return Response.json({ error: "Operational access denied." }, { status: 403 });
  if (error instanceof Error && error.message === "OPERATIONAL_ACCESS_MISCONFIGURED")
    return Response.json(
      { error: "Operational access is not configured safely." },
      { status: 503 },
    );
  return undefined;
}

function liveAiVolumeAlertThreshold(): number {
  const value = Number(process.env.OPERATIONAL_LIVE_AI_VOLUME_ALERT_THRESHOLD);
  return Number.isSafeInteger(value) && value > 0 && value <= 100_000 ? value : 500;
}

export async function GET(request: Request) {
  try {
    const user = await requireOperationalRole("support", await requireUser());
    if (getRuntimeAdapter() !== "supabase")
      return Response.json(
        { error: "Operational diagnostics require the durable database adapter." },
        { status: 503 },
      );
    const client = getSystemDatabaseClient();
    const traceId = new URL(request.url).searchParams.get("traceId");
    const parsedTraceId = traceId ? traceIdSchema.parse(traceId) : undefined;
    const diagnostics = await inspectJobQueues(client);
    const productEventRows = await client<{ event_name: string; count: number }[]>`
      select event_name, count(*)::integer as count
      from product_events
      where created_at >= now() - interval '24 hours'
      group by event_name
      order by event_name
    `;
    const runtimeConfiguration = await getRuntimeConfiguration();
    const providerRoute = configuredAiProviderRoute();
    const interpretationOptions = interpretationRuntimeOptions(runtimeConfiguration);
    const interpretationProvider = createInterpretationProvider(interpretationOptions);
    const liveInterpretation =
      interpretationProvider.id.startsWith("groq:") ||
      interpretationProvider.id.startsWith("groq-gateway:");
    const traces = parsedTraceId
      ? await client<{ entity_type: string; status: string; created_at: Date }[]>`
          select entity_type, status, created_at from (
            select 'reading'::text as entity_type, state::text as status, created_at
              from reading_sessions where id = ${parsedTraceId}
            union all
            select 'interpretation-job'::text, status::text, created_at
              from interpretation_jobs where reading_id = ${parsedTraceId}
            union all
            select 'report'::text, status::text, created_at
              from reports where id = ${parsedTraceId}
            union all
            select 'report-job'::text, status::text, created_at
              from report_jobs where report_id = ${parsedTraceId}
            union all
            select 'order'::text, status::text, created_at
              from orders where id = ${parsedTraceId}
          ) trace order by entity_type
        `
      : [];
    return Response.json({
      role: user.operationalRole,
      diagnostics,
      productMeasurement: {
        windowHours: 24,
        events: Object.fromEntries(productEventRows.map((row) => [row.event_name, row.count])),
      },
      trace: parsedTraceId
        ? {
            id: parsedTraceId,
            entities: traces.map((row) => ({
              type: row.entity_type,
              status: row.status,
              createdAt: row.created_at.toISOString(),
            })),
          }
        : null,
      configuration: {
        aiGenerationEnabled: liveInterpretation,
        aiTransport:
          liveInterpretation && providerRoute.invalidEnvironmentVariables.length === 0
            ? providerRoute.kind
            : "deterministic",
        aiModels: liveInterpretation
          ? interpretationOptions.modelChain
          : ["deterministic fallback"],
        profileReportsEnabled: profileReportsEnabled(runtimeConfiguration),
        readingAccessMode: runtimeConfiguration.commerce.readingAccessMode,
        freeAllowance: runtimeConfiguration.commerce.freeAllowance,
        allowanceWindowHours: runtimeConfiguration.commerce.allowanceWindowHours,
        promptBundle: runtimeConfiguration.prompts.bundleId,
        enabledSpreadCount: runtimeConfiguration.content.enabledSpreadIds.length,
        animationVariant: runtimeConfiguration.features.animationVariant,
        operationalAlertReceiverSet: Boolean(process.env.OPERATIONAL_ALERT_WEBHOOK_URL?.trim()),
        liveAiVolumeAlertThreshold: liveAiVolumeAlertThreshold(),
        configurationVersions: Object.entries(runtimeConfiguration.versions)
          .map(([domain, version]) => `${domain}:${version ?? "environment"}`)
          .join(", "),
      },
    });
  } catch (error) {
    const response = operationalError(error);
    if (response) return response;
    if (error instanceof z.ZodError)
      return Response.json({ error: "Use an exact non-sensitive UUID trace ID." }, { status: 422 });
    return Response.json({ error: "Operational diagnostics are unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireOperationalRole("operator", await requireUser());
    await assertRateLimit(`operations:${user.id}`, 12, 60 * 60_000);
    if (getRuntimeAdapter() !== "supabase")
      return Response.json(
        { error: "Operational retry requires durable queues." },
        { status: 503 },
      );
    const input = retrySchema.parse(await request.json());
    const client = getSystemDatabaseClient();
    const retried = await client.begin(async (transaction) => {
      if (input.queue === "interpretation") {
        const [job] = await transaction<{ status: string }[]>`
          select status from interpretation_jobs
          where reading_id = ${input.targetId} for update
        `;
        if (job?.status !== "failed") return false;
        await reenqueueInterpretationJob(transaction, input.targetId);
      } else {
        const [job] = await transaction<{ status: string }[]>`
          select status from report_jobs where report_id = ${input.targetId} for update
        `;
        if (job?.status !== "failed") return false;
        if (!(await reenqueueReportJob(transaction, input.targetId))) return false;
      }
      // The retry and its audit receipt share one transaction: neither may
      // survive alone if the other write fails.
      await transaction`
        insert into audit_events (user_id, action, target_type, target_id, metadata)
        values (
          ${user.id},
          'operations.job.retried',
          ${`${input.queue}-job`},
          ${input.targetId},
          '{}'::jsonb
        )
      `;
      return true;
    });
    if (!retried)
      return Response.json(
        { error: "Only a failed retained job can be retried with this action." },
        { status: 409 },
      );
    await tryRecordProductEvent({
      idempotencyKey: `operations:${input.queue}:${input.targetId}:retry:${randomUUID()}`,
      name: "job_retried",
      properties: { statusClass: "started" },
    });
    return Response.json({ retried: true, queue: input.queue, targetId: input.targetId });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return Response.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    const response = operationalError(error);
    if (response) return response;
    if (error instanceof z.ZodError)
      return Response.json({ error: "Check the operational retry request." }, { status: 422 });
    return Response.json(
      { error: "The operational retry could not be scheduled." },
      { status: 500 },
    );
  }
}
