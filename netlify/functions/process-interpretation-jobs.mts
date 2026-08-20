// Durability backstop for background interpretation and paid-report generation (StarGuidance
// Workstream B — see docs/KNOWN-GAPS.md). Deliberately zero workspace/npm
// dependencies beyond @netlify/functions' types: Netlify's zip-it-and-ship-it
// bundler cannot resolve `postgres` at runtime for a standalone Netlify
// Function (netlify/zip-it-and-ship-it#869, confirmed here across three
// bundler configurations before this file existed). The actual
// claim/AI-call/write work lives behind the already-proven Next.js/Postgres
// path at POST /api/internal/interpretation-jobs; this function's only job is
// to fetch that route on a schedule with a bearer token, using nothing but
// Node's built-in `crypto` (never an npm package).
import type { Config } from "@netlify/functions";
import { createHmac } from "node:crypto";

// Must match @starguidance/contracts' INTERPRETATION_WORKER_TOKEN_CONTEXT
// exactly — this derives the same HMAC so the raw INTERPRETATION_WORKER_SECRET
// is never sent over the wire, only a token derived from it. Kept as this
// file's own literal (rather than importing the package) so the deployed
// bundle stays dependency-free; exported so a sibling test can assert the two
// copies haven't drifted apart.
export const TOKEN_CONTEXT = "starguidance-interpretation-worker-v1";

// The drain route claims one potentially long interpretation and up to ten
// deterministic report jobs per invocation. These fixed defaults are
// deliberately conservative; the live-AI volume threshold is configurable
// because it is the cost-budget proxy and must match the approved provider
// budget for each environment.
const QUEUE_DEPTH_ALERT_THRESHOLD = 20;
const QUEUE_AGE_ALERT_THRESHOLD_SECONDS = 180;
const AUTH_FAILURE_ALERT_THRESHOLD = 20;
const PROFILE_FAILURE_ALERT_THRESHOLD = 5;
const GENERATION_FAILURE_ALERT_THRESHOLD = 5;
const PAYMENT_FAILURE_ALERT_THRESHOLD = 2;
const SLOW_GENERATION_ALERT_THRESHOLD = 3;

const ALERT_MESSAGES = {
  interpretation_queue_depth: "interpretation queue depth",
  report_queue_depth: "report queue depth",
  interpretation_queue_age: "interpretation queue age seconds",
  report_queue_age: "report queue age seconds",
  interpretation_job_failure: "interpretation jobs failed this cycle",
  report_job_failure: "report jobs failed this cycle",
  auth_failure_rate: "authentication failures in five minutes",
  profile_failure_rate: "profile failures in five minutes",
  generation_failure_rate: "generation failures in five minutes",
  payment_failure_rate: "payment failures in fifteen minutes",
  generation_latency: "slow generations in five minutes",
  live_ai_volume: "live AI generations in sixty minutes",
} as const;

export type OperationalAlertClass = keyof typeof ALERT_MESSAGES;

export interface OperationalAlert {
  alertClass: OperationalAlertClass;
  severity: "warning" | "critical";
  observed: number;
  threshold: number;
}

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function numericField(object: Record<string, unknown> | undefined, field: string): number {
  const value = object?.[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nestedObject(
  object: Record<string, unknown> | undefined,
  field: string,
): Record<string, unknown> | undefined {
  const value = object?.[field];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function evaluateOperationalAlerts(body: unknown): OperationalAlert[] {
  const object = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  const reports = nestedObject(object, "reports");
  const signals = nestedObject(object, "signals");
  const liveAiVolumeThreshold = boundedPositiveInteger(
    process.env.OPERATIONAL_LIVE_AI_VOLUME_ALERT_THRESHOLD,
    500,
    100_000,
  );
  const candidates: Array<OperationalAlert> = [
    {
      alertClass: "interpretation_queue_depth",
      severity: "critical",
      observed: numericField(object, "queueDepth"),
      threshold: QUEUE_DEPTH_ALERT_THRESHOLD,
    },
    {
      alertClass: "report_queue_depth",
      severity: "critical",
      observed: numericField(object, "reportQueueDepth"),
      threshold: QUEUE_DEPTH_ALERT_THRESHOLD,
    },
    {
      alertClass: "interpretation_queue_age",
      severity: "critical",
      observed: numericField(object, "oldestPendingAgeSeconds"),
      threshold: QUEUE_AGE_ALERT_THRESHOLD_SECONDS,
    },
    {
      alertClass: "report_queue_age",
      severity: "critical",
      observed: numericField(object, "oldestPendingReportAgeSeconds"),
      threshold: QUEUE_AGE_ALERT_THRESHOLD_SECONDS,
    },
    {
      alertClass: "interpretation_job_failure",
      severity: "warning",
      observed: numericField(object, "failed"),
      threshold: 0,
    },
    {
      alertClass: "report_job_failure",
      severity: "warning",
      observed: numericField(reports, "failed"),
      threshold: 0,
    },
    {
      alertClass: "auth_failure_rate",
      severity: "warning",
      observed: numericField(signals, "authFailures5m"),
      threshold: AUTH_FAILURE_ALERT_THRESHOLD,
    },
    {
      alertClass: "profile_failure_rate",
      severity: "critical",
      observed: numericField(signals, "profileFailures5m"),
      threshold: PROFILE_FAILURE_ALERT_THRESHOLD,
    },
    {
      alertClass: "generation_failure_rate",
      severity: "critical",
      observed: numericField(signals, "generationFailures5m"),
      threshold: GENERATION_FAILURE_ALERT_THRESHOLD,
    },
    {
      alertClass: "payment_failure_rate",
      severity: "critical",
      observed: numericField(signals, "paymentFailures15m"),
      threshold: PAYMENT_FAILURE_ALERT_THRESHOLD,
    },
    {
      alertClass: "generation_latency",
      severity: "warning",
      observed: numericField(signals, "slowGenerations5m"),
      threshold: SLOW_GENERATION_ALERT_THRESHOLD,
    },
    {
      alertClass: "live_ai_volume",
      severity: "warning",
      observed: numericField(signals, "liveGenerations60m"),
      threshold: liveAiVolumeThreshold,
    },
  ];
  return candidates.filter(({ observed, threshold }) => observed > threshold);
}

function operationalEnvironment(): "staging" | "production" | "unknown" {
  if (process.env.APP_ENV === "staging" || process.env.APP_ENV === "production")
    return process.env.APP_ENV;
  return "unknown";
}

function alertWebhook(): URL | undefined {
  const configured = process.env.OPERATIONAL_ALERT_WEBHOOK_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

async function deliverOperationalAlerts(alerts: readonly OperationalAlert[]): Promise<void> {
  if (alerts.length === 0) return;
  for (const alert of alerts)
    console.error(
      `process-interpretation-jobs: ${ALERT_MESSAGES[alert.alertClass]} ${alert.observed} exceeds alert threshold ${alert.threshold}`,
    );
  const webhook = alertWebhook();
  if (!webhook) return;
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "starguidance_operational_alert",
        version: "operational-alert-v1",
        environment: operationalEnvironment(),
        alerts,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
      console.error(`process-interpretation-jobs: alert webhook responded ${response.status}`);
  } catch {
    console.error("process-interpretation-jobs: alert webhook request failed");
  }
}

/**
 * Parses the drain route's already-fetched response body for both queue
 * depths and alerts when either is over threshold. Never throws: a malformed or
 * unexpected body is itself worth a log line, but must never turn a
 * successful trigger into a reported failure.
 */
async function alertOnOperationalSignals(response: Response): Promise<void> {
  try {
    const body: unknown = await response.json();
    await deliverOperationalAlerts(evaluateOperationalAlerts(body));
  } catch {
    console.error("process-interpretation-jobs: could not parse trigger response body");
  }
}

async function handler(): Promise<Response> {
  const target = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.INTERPRETATION_WORKER_SECRET;
  if (!target || !secret) {
    console.error(
      "process-interpretation-jobs: missing NEXT_PUBLIC_APP_URL or INTERPRETATION_WORKER_SECRET",
    );
    return new Response(null, { status: 500 });
  }
  const token = createHmac("sha256", secret).update(TOKEN_CONTEXT).digest("base64url");
  try {
    const response = await fetch(new URL("/api/internal/interpretation-jobs", target), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      console.error(`process-interpretation-jobs: trigger responded ${response.status}`);
      return new Response(null, { status: 502 });
    }
    await alertOnOperationalSignals(response);
    return new Response(null, { status: 202 });
  } catch {
    console.error("process-interpretation-jobs: trigger request failed");
    return new Response(null, { status: 502 });
  }
}

export default handler;

export const config: Config = { schedule: "*/1 * * * *" };
