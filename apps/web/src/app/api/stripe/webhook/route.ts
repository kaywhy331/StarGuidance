import { NextResponse } from "next/server";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { localStore } from "@/lib/local-store";
import { generateProfileReport } from "@/lib/report";

export async function POST(request: Request) {
  if (process.env.APP_ENV === "production")
    return NextResponse.json(
      { error: "Configure durable production webhook storage before enabling Stripe." },
      { status: 503 },
    );
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secretKey || !webhookSecret || !signature)
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  try {
    const stripe = new Stripe(secretKey);
    const event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
    const eventKey = `stripe-event:${event.id}`;
    if (localStore.idempotency.has(eventKey)) return NextResponse.json({ received: true });
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status !== "paid") {
        localStore.idempotency.set(eventKey, "awaiting-payment");
        return NextResponse.json({ received: true });
      }
      const { userId, snapshotId, orderId } = session.metadata ?? {};
      const order = orderId ? localStore.orders.get(orderId) : undefined;
      if (!userId || !snapshotId || !orderId || !order)
        return NextResponse.json({ error: "Unknown Checkout order." }, { status: 422 });
      order.status = "paid";
      localStore.entitlements.set(orderId, {
        id: randomUUID(),
        userId,
        snapshotId,
        orderId,
        createdAt: new Date().toISOString(),
      });
      const report = await generateProfileReport({ userId, snapshotId, orderId });
      localStore.idempotency.set(eventKey, report.id);
    } else {
      localStore.idempotency.set(eventKey, "ignored");
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature or payload." }, { status: 400 });
  }
}
