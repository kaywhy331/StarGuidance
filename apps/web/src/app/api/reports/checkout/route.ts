import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { assertCurrentPolicyConsents, POLICY_RECONSENT_REQUIRED, requireUser } from "@/lib/auth";
import { isLocalRuntimeAdapterAuthorized } from "@/lib/hosted-runtime";
import { persistenceFor } from "@/lib/persistence";
import { tryRecordProductEvent } from "@/lib/product-telemetry";
import { generateProfileReport, prepareProfileReportSource } from "@/lib/report";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";
import { isStripeTestSecret } from "@/lib/stripe-events";
import {
  getRuntimeConfiguration,
  profileReportsEnabled,
  type CommerceConfiguration,
} from "@/lib/runtime-configuration";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function recordCheckoutStarted(
  orderId: string,
  provider: "local" | "stripe",
  commerce: CommerceConfiguration,
) {
  await tryRecordProductEvent({
    idempotencyKey: `order:${orderId}:checkout-started`,
    name: "checkout_started",
    properties: {
      productId: "profile-report-v1",
      provider,
      statusClass: "started",
      ...(commerce.stripePriceId ? { priceId: commerce.stripePriceId } : {}),
      currency: commerce.currency,
      priceMinor: commerce.priceMinor,
    },
  });
}

function configuredPaymentsProvider(): "local" | "stripe" | undefined {
  const provider = process.env.PAYMENTS_PROVIDER;
  if (provider === "stripe") return provider;
  if (provider === "local" && isLocalRuntimeAdapterAuthorized()) return provider;
  return undefined;
}

function stripeConfiguration(
  price: string | undefined,
): { secretKey: string; price: string; appUrl: string } | undefined {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return secretKey && isStripeTestSecret(secretKey) && price && appUrl
    ? { secretKey, price, appUrl }
    : undefined;
}

async function createCheckoutSession(input: {
  stripe: Stripe;
  price: string;
  appUrl: string;
  email: string;
  orderId: string;
  idempotencyKey: string;
}): Promise<Stripe.Checkout.Session> {
  return input.stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{ price: input.price, quantity: 1 }],
      customer_email: input.email,
      client_reference_id: input.orderId,
      metadata: { orderId: input.orderId },
      payment_intent_data: { metadata: { orderId: input.orderId } },
      success_url: `${input.appUrl}/profile?checkout=success`,
      cancel_url: `${input.appUrl}/profile?checkout=cancelled`,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const runtimeConfiguration = await getRuntimeConfiguration();
    if (!profileReportsEnabled(runtimeConfiguration))
      return NextResponse.json(
        { error: "Profile reports are not available in this beta." },
        { status: 404 },
      );
    const paymentsProvider = configuredPaymentsProvider();
    if (!paymentsProvider)
      return NextResponse.json(
        { error: "Profile report payments are not configured for this environment." },
        { status: 503 },
      );
    const user = await requireUser();
    assertCurrentPolicyConsents(user);
    await assertRateLimit(`checkout:${user.id}`, 6);
    const persistence = persistenceFor(user);
    const submittedKey = request.headers.get("idempotency-key");
    if (submittedKey && !UUID.test(submittedKey))
      return NextResponse.json({ error: "Invalid idempotency key." }, { status: 400 });
    const key = submittedKey ?? randomUUID();
    const keyedOrder = await persistence.repositories.orders.getByIdempotencyKey(user.id, key);
    const profile = keyedOrder
      ? undefined
      : await persistence.repositories.birthProfiles.getActive(user.id);
    const orders = keyedOrder ? [] : await persistence.repositories.orders.list(user.id);
    const existingOrder =
      keyedOrder ??
      (profile
        ? orders.find(
            (order) =>
              order.snapshotId === profile.snapshot.id &&
              (order.status === "pending" || order.status === "paid"),
          )
        : orders.findLast((order) => order.status === "pending" || order.status === "paid"));
    if (existingOrder) {
      const existingReport = await persistence.repositories.reports.getByOrder(
        user.id,
        existingOrder.id,
      );
      if (
        !existingReport &&
        existingOrder.provider === "stripe" &&
        existingOrder.status === "pending"
      ) {
        const configuration = stripeConfiguration(runtimeConfiguration.commerce.stripePriceId);
        if (!configuration)
          return NextResponse.json(
            { error: "Stripe Checkout requires configured test credentials." },
            { status: 503 },
          );
        const stripe = new Stripe(configuration.secretKey);
        let session: Stripe.Checkout.Session;
        try {
          session = await stripe.checkout.sessions.retrieve(existingOrder.providerSessionId);
        } catch {
          return NextResponse.json(
            { error: "Stripe Checkout is temporarily unavailable." },
            { status: 502 },
          );
        }
        if (session.status === "open" && session.url) {
          await recordCheckoutStarted(existingOrder.id, "stripe", runtimeConfiguration.commerce);
          return NextResponse.json({
            checkoutUrl: session.url,
            orderId: existingOrder.id,
            status: existingOrder.status,
            adapter: existingOrder.provider,
          });
        }
        if (session.status === "expired") {
          let replacement: Stripe.Checkout.Session;
          try {
            replacement = await createCheckoutSession({
              stripe,
              price: configuration.price,
              appUrl: configuration.appUrl,
              email: user.email,
              orderId: existingOrder.id,
              idempotencyKey: `${user.id}:${existingOrder.idempotencyKey}:resume:${existingOrder.providerSessionId}`,
            });
          } catch {
            return NextResponse.json(
              { error: "Stripe Checkout is temporarily unavailable." },
              { status: 502 },
            );
          }
          if (!replacement.url)
            return NextResponse.json(
              { error: "Stripe Checkout returned an invalid session." },
              { status: 502 },
            );
          const replaced = await persistence.repositories.orders.replaceProviderSession(
            user.id,
            existingOrder.id,
            existingOrder.providerSessionId,
            replacement.id,
          );
          const current = replaced
            ? existingOrder
            : await persistence.repositories.orders.get(user.id, existingOrder.id);
          if (!replaced && current?.providerSessionId !== replacement.id)
            return NextResponse.json(
              { error: "Checkout changed in another request. Try again." },
              { status: 409 },
            );
          await recordCheckoutStarted(existingOrder.id, "stripe", runtimeConfiguration.commerce);
          return NextResponse.json({
            checkoutUrl: replacement.url,
            orderId: existingOrder.id,
            status: existingOrder.status,
            adapter: existingOrder.provider,
          });
        }
      }
      return NextResponse.json({
        ...(existingReport ? { reportId: existingReport.id } : { orderId: existingOrder.id }),
        status: existingOrder.status,
        ...(existingReport ? { reportStatus: existingReport.status } : {}),
        adapter: existingOrder.provider,
      });
    }
    if (!profile) return NextResponse.json({ error: "A profile is required." }, { status: 409 });
    if (paymentsProvider === "stripe") {
      const configuration = stripeConfiguration(runtimeConfiguration.commerce.stripePriceId);
      if (!configuration)
        return NextResponse.json(
          { error: "Stripe Checkout requires configured test credentials." },
          { status: 503 },
        );
      const orderId = randomUUID();
      const encryptedReportSource = await prepareProfileReportSource({
        userId: user.id,
        snapshotId: profile.snapshot.id,
      });
      // Provider idempotency is stable for the active snapshot attempt, not
      // controlled by a tab's request key. Two tabs that race before either
      // order is persisted therefore receive the same Stripe session instead
      // of creating two payable Checkouts. A terminal order increments the
      // attempt count so a later, intentional purchase can create a new one.
      const purchaseAttempt = orders.filter(
        (order) => order.snapshotId === profile.snapshot.id,
      ).length;
      const stripe = new Stripe(configuration.secretKey);
      let session: Stripe.Checkout.Session;
      try {
        session = await createCheckoutSession({
          stripe,
          price: configuration.price,
          appUrl: configuration.appUrl,
          email: user.email,
          orderId,
          idempotencyKey: `${user.id}:${profile.snapshot.id}:purchase:${purchaseAttempt}`,
        });
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
      await persistence.repositories.orders.create(
        {
          id: persistedOrderId,
          userId: user.id,
          snapshotId: profile.snapshot.id,
          provider: "stripe",
          providerSessionId: session.id,
          idempotencyKey: key,
          status: "pending",
          createdAt: new Date().toISOString(),
        },
        encryptedReportSource,
      );
      await recordCheckoutStarted(persistedOrderId, "stripe", runtimeConfiguration.commerce);
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
    await recordCheckoutStarted(orderId, "local", runtimeConfiguration.commerce);
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
    await Promise.all([
      tryRecordProductEvent({
        idempotencyKey: `order:${orderId}:purchase-completed`,
        name: "purchase_completed",
        properties: {
          productId: "profile-report-v1",
          provider: "local",
          statusClass: "completed",
        },
      }),
      tryRecordProductEvent({
        idempotencyKey: `report:${report.id}:ready`,
        name: "report_ready",
        properties: {
          productId: "profile-report-v1",
          provider: "local",
          statusClass: "ready",
        },
      }),
    ]);
    return NextResponse.json({ reportId: report.id, adapter: "local" }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (reason === POLICY_RECONSENT_REQUIRED)
      return NextResponse.json(
        { error: "Review the current service policies before purchasing a report." },
        { status: 428 },
      );
    if (reason === "INVALID_ORIGIN" || reason === "MISSING_ORIGIN")
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
