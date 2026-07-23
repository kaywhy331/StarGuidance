import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { requireUser } from "@/lib/auth";
import { localStore } from "@/lib/local-store";
import { generateProfileReport } from "@/lib/report";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    if (process.env.APP_ENV === "production")
      return NextResponse.json(
        { error: "Configure the durable production commerce adapter before enabling Checkout." },
        { status: 503 },
      );
    const user = await requireUser();
    assertSameOrigin(request);
    assertRateLimit(`checkout:${user.id}`, 6);
    if (!user.profile)
      return NextResponse.json({ error: "A profile is required." }, { status: 409 });
    const key = request.headers.get("idempotency-key") ?? randomUUID();
    const existingId = localStore.idempotency.get(`${user.id}:${key}`);
    if (existingId) {
      if (localStore.reports.has(existingId))
        return NextResponse.json({ reportId: existingId, adapter: "local" });
      const order = localStore.orders.get(existingId);
      if (order)
        return NextResponse.json({
          orderId: order.id,
          status: order.status,
          adapter: order.provider,
        });
    }
    if (process.env.PAYMENTS_PROVIDER === "stripe") {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      const price = process.env.STRIPE_PROFILE_REPORT_PRICE_ID;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!secretKey || !price || !appUrl)
        return NextResponse.json(
          { error: "Stripe Checkout requires configured test credentials." },
          { status: 503 },
        );
      const orderId = randomUUID();
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ price, quantity: 1 }],
          customer_email: user.email,
          client_reference_id: orderId,
          metadata: { userId: user.id, snapshotId: user.profile.snapshot.id, orderId },
          success_url: `${appUrl}/profile?checkout=success`,
          cancel_url: `${appUrl}/profile?checkout=cancelled`,
        },
        { idempotencyKey: `${user.id}:${key}` },
      );
      localStore.orders.set(orderId, {
        id: orderId,
        userId: user.id,
        snapshotId: user.profile.snapshot.id,
        provider: "stripe",
        providerSessionId: session.id,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      localStore.idempotency.set(`${user.id}:${key}`, orderId);
      return NextResponse.json({ checkoutUrl: session.url, orderId, adapter: "stripe" });
    }
    const orderId = randomUUID();
    const now = new Date().toISOString();
    localStore.orders.set(orderId, {
      id: orderId,
      userId: user.id,
      snapshotId: user.profile.snapshot.id,
      provider: "local",
      status: "paid",
      createdAt: now,
    });
    localStore.entitlements.set(orderId, {
      id: randomUUID(),
      userId: user.id,
      snapshotId: user.profile.snapshot.id,
      orderId,
      createdAt: now,
    });
    const report = await generateProfileReport({
      userId: user.id,
      snapshotId: user.profile.snapshot.id,
      orderId,
    });
    localStore.idempotency.set(`${user.id}:${key}`, report.id);
    return NextResponse.json({ reportId: report.id, adapter: "local" }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
