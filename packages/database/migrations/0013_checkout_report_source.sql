/*
 * Stage a minimized, encrypted derived-profile source before redirecting to
 * Stripe. If the user deletes their private profile while Checkout is open,
 * the authenticated paid webhook can still enqueue the purchased report.
 * Fulfillment or a terminal Checkout event clears this temporary copy.
 */
ALTER TABLE "orders" ADD COLUMN "encrypted_report_source" text;
