import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import Stripe from "stripe";

import { generateProfileReport } from "@/lib/report";
import { getServiceRepositories } from "@/lib/runtime";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secretKey || !webhookSecret || !signature)
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  try {
    const stripe = new Stripe(secretKey);
    const event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
    const repositories = getServiceRepositories();
    if (!(await repositories.webhookEvents.begin(event.id, event.type)))
      return NextResponse.json({ received: true });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        const order = await repositories.orders.getByProviderSession(session.id);
        if (!order || session.metadata?.orderId !== order.id)
          return NextResponse.json({ error: "Unknown Checkout order." }, { status: 422 });
        await repositories.orders.setStatus(order.id, "paid");
        await repositories.entitlements.grant({
          id: randomUUID(),
          userId: order.userId,
          snapshotId: order.snapshotId,
          orderId: order.id,
          status: "active",
          createdAt: new Date().toISOString(),
        });
        await generateProfileReport({
          userId: order.userId,
          snapshotId: order.snapshotId,
          orderId: order.id,
        });
      }
    }
    await repositories.webhookEvents.complete(event.id);
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature or payload." }, { status: 400 });
  }
}
