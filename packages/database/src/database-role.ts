/**
 * Server-only role used for all subject-scoped SQL transactions.
 *
 * Supabase assigns browser JWTs to `authenticated`; keeping that role away
 * from private tables prevents a browser from bypassing the Next.js boundary
 * and mutating a locked draw, entitlement, audit event, or encrypted payload.
 */
export const APPLICATION_DATABASE_ROLE = "starguidance_app";
