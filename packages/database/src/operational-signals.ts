import type { DatabaseClient, DatabaseTransaction } from "./postgres-client";

interface OperationalSignalRow {
  auth_failures_5m: number;
  profile_failures_5m: number;
  generation_failures_5m: number;
  payment_failures_15m: number;
  slow_generations_5m: number;
  live_generations_60m: number;
}

export interface ProductOperationalSignals {
  authFailures5m: number;
  profileFailures5m: number;
  generationFailures5m: number;
  paymentFailures15m: number;
  slowGenerations5m: number;
  liveGenerations60m: number;
}

function safeCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0;
}

export function normalizeProductOperationalSignals(
  row?: Partial<OperationalSignalRow>,
): ProductOperationalSignals {
  return {
    authFailures5m: safeCount(row?.auth_failures_5m),
    profileFailures5m: safeCount(row?.profile_failures_5m),
    generationFailures5m: safeCount(row?.generation_failures_5m),
    paymentFailures15m: safeCount(row?.payment_failures_15m),
    slowGenerations5m: safeCount(row?.slow_generations_5m),
    liveGenerations60m: safeCount(row?.live_generations_60m),
  };
}

/**
 * Returns only closed aggregate counters. Product events contain no subject
 * identifier or content, and this query never selects their idempotency hash
 * or properties object. The scheduled monitor uses these counters to decide
 * whether a user-impacting condition crosses a reviewed threshold.
 */
export async function getProductOperationalSignals(
  client: DatabaseClient | DatabaseTransaction,
): Promise<ProductOperationalSignals> {
  const [row] = await client<OperationalSignalRow[]>`
    select
      count(*) filter (
        where event_name = 'auth_failed'
          and created_at >= now() - interval '5 minutes'
      )::integer as auth_failures_5m,
      count(*) filter (
        where event_name = 'profile_failed'
          and created_at >= now() - interval '5 minutes'
      )::integer as profile_failures_5m,
      count(*) filter (
        where event_name = 'generation_failed'
          and created_at >= now() - interval '5 minutes'
      )::integer as generation_failures_5m,
      count(*) filter (
        where event_name = 'payment_failed'
          and created_at >= now() - interval '15 minutes'
      )::integer as payment_failures_15m,
      count(*) filter (
        where event_name = 'generation_completed'
          and created_at >= now() - interval '5 minutes'
          and properties->>'durationBucket' in ('15_40s', 'gt_40s')
      )::integer as slow_generations_5m,
      count(*) filter (
        where event_name = 'generation_completed'
          and created_at >= now() - interval '60 minutes'
          and properties->>'generationMode' = 'live'
      )::integer as live_generations_60m
    from product_events
  `;
  return normalizeProductOperationalSignals(row);
}
