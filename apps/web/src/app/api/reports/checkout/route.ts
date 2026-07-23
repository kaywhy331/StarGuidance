import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { generateProfileReport } from "@/lib/report";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertSameOrigin(request);
    assertRateLimit(`checkout:${user.id}`, 6);
    const persistence = persistenceFor(user);
    const profile = await persistence.repositories.birthProfiles.getActive(user.id);
    if (!profile) return NextResponse.json({ error: "A profile is required." }, { status: 409 });
    const key = request.headers.get("idempotency-key") ?? randomUUID();
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
          metadata: { orderId },
          success_url: `${appUrl}/profile?checkout=success`,
          cancel_url: `${appUrl}/profile?checkout=cancelled`,
        },
        { idempotencyKey: `${user.id}:${key}` },
      );
      await persistence.repositories.orders.create({
        id: orderId,
        userId: user.id,
        snapshotId: profile.snapshot.id,
        provider: "stripe",
        providerSessionId: session.id,
        idempotencyKey: key,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ checkoutUrl: session.url, orderId, adapter: "stripe" });
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
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
