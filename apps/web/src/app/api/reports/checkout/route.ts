import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { generateProfileReport } from "@/lib/report";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";
import { isStripeTestSecret } from "@/lib/stripe-events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertSameOrigin(request);
    assertRateLimit(`checkout:${user.id}`, 6);
    const persistence = persistenceFor(user);
    const profile = await persistence.repositories.birthProfiles.getActive(user.id);
    if (!profile) return NextResponse.json({ error: "A profile is required." }, { status: 409 });
    const submittedKey = request.headers.get("idempotency-key");
    if (submittedKey && !UUID.test(submittedKey))
      return NextResponse.json({ error: "Invalid idempotency key." }, { status: 400 });
    const key = submittedKey ?? randomUUID();
    const existingOrder = await persistence.repositories.orders.getByIdempotencyKey(user.id, key);
    if (existingOrder) {
      const existingReport = (await persistence.repositories.reports.list(user.id)).find(
        ({ orderId }) => orderId === existingOrder.id,
      );
      return NextResponse.json({
        ...(existingReport ? { reportId: existingReport.id } : { orderId: existingOrder.id }),
        status: existingOrder.status,
        adapter: existingOrder.provider,
      });
    }
    if (process.env.PAYMENTS_PROVIDER === "stripe") {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      const price = process.env.STRIPE_PROFILE_REPORT_PRICE_ID;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!secretKey || !isStripeTestSecret(secretKey) || !price || !appUrl)
        return NextResponse.json(
          { error: "Stripe Checkout requires configured test credentials." },
          { status: 503 },
        );
      const orderId = randomUUID();
      const stripe = new Stripe(secretKey);
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [{ price, quantity: 1 }],
            customer_email: user.email,
            client_reference_id: orderId,
            metadata: { orderId },
            payment_intent_data: { metadata: { orderId } },
            success_url: `${appUrl}/profile?checkout=success`,
            cancel_url: `${appUrl}/profile?checkout=cancelled`,
          },
          { idempotencyKey: `${user.id}:${key}` },
        );
      } catch {
        return NextResponse.json(
          { error: "Stripe Checkout is temporarily unavailable." },
          { status: 502 },
        );
      }
      const persistedOrderId = session.metadata?.orderId;
      if (!persistedOrderId || !UUID.test(persistedOrderId) || !session.url)
        return NextResponse.json(
          { error: "Stripe Checkout returned an invalid session." },
          { status: 502 },
        );
      await persistence.repositories.orders.create({
        id: persistedOrderId,
        userId: user.id,
        snapshotId: profile.snapshot.id,
        provider: "stripe",
        providerSessionId: session.id,
        idempotencyKey: key,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({
        checkoutUrl: session.url,
        orderId: persistedOrderId,
        adapter: "stripe",
      });
    }
    const orderId = randomUUID();
    const now = new Date().toISOString();
    await persistence.repositories.orders.create({
      id: orderId,
      userId: user.id,
      snapshotId: profile.snapshot.id,
      provider: "local",
      providerSessionId: `local:${orderId}`,
      idempotencyKey: key,
      status: "paid",
      createdAt: now,
    });
    await persistence.repositories.entitlements.grant({
      id: randomUUID(),
      userId: user.id,
      snapshotId: profile.snapshot.id,
      orderId,
      status: "active",
      createdAt: now,
    });
    const report = await generateProfileReport({
      userId: user.id,
      snapshotId: profile.snapshot.id,
      orderId,
    });
    return NextResponse.json({ reportId: report.id, adapter: "local" }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (reason === "INVALID_ORIGIN")
      return NextResponse.json({ error: "Request origin was rejected." }, { status: 403 });
    if (reason === "RATE_LIMITED")
      return NextResponse.json(
        { error: "Too many Checkout attempts. Try again shortly." },
        { status: 429, headers: { "retry-after": "60" } },
      );
    return NextResponse.json(
      { error: "Checkout could not be prepared. Try again shortly." },
      { status: 503 },
    );
  }
}
