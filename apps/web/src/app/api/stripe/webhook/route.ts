import { NextResponse } from "next/server";
import Stripe from "stripe";

import { getServiceRepositories } from "@/lib/runtime";
import { isStripeTestSecret, processStripeEvent } from "@/lib/stripe-events";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (
    process.env.ENABLE_PROFILE_REPORTS !== "true" ||
    process.env.PAYMENTS_PROVIDER !== "stripe" ||
    !secretKey ||
    !isStripeTestSecret(secretKey) ||
    !webhookSecret ||
    !signature
  )
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  let claimedEventId: string | undefined;
  let repositories: ReturnType<typeof getServiceRepositories> | undefined;
  try {
    const stripe = new Stripe(secretKey);
    const event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
    if (event.livemode)
      return NextResponse.json({ error: "Live payment events are disabled." }, { status: 400 });
    repositories = getServiceRepositories();
    if (!(await repositories.webhookEvents.begin(event.id, event.type)))
      return NextResponse.json({ received: true });
    claimedEventId = event.id;
    await processStripeEvent(event, {
      stripe,
      repositories,
    });
    await repositories.webhookEvents.complete(event.id);
    return NextResponse.json({ received: true });
  } catch {
    if (claimedEventId && repositories) {
      await repositories.webhookEvents
        .fail(claimedEventId, "processing_failed")
        .catch(() => undefined);
      return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
    }
    return NextResponse.json({ error: "Invalid webhook signature or payload." }, { status: 400 });
  }
}
