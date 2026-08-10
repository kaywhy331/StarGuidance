"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, LoadingState, Panel } from "@starguidance/design-system";
import { PROFILE_REPORT_SECTION_PREVIEW } from "@/lib/report-sections";

interface ProfileView {
  snapshot: { id: string; version: number; completeness: string };
  maskedName: string;
  birthDate: string;
  birthTimeProvided: boolean;
  birthplaceLabel?: string;
}

const CHECKOUT_KEY_STORAGE = "starguidance:profile-report-checkout-key";

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileView | null>();
  const [message, setMessage] = useState<string>();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [checkoutState, setCheckoutState] = useState<"idle" | "cancelled" | "pending">("idle");
  const processedCheckoutReturn = useRef(false);
  const router = useRouter();
  const profileReportsEnabled = process.env.NEXT_PUBLIC_ENABLE_PROFILE_REPORTS === "true";
  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) return router.push("/sign-in");
      const payload = (await response.json()) as { profile: ProfileView | null };
      setProfile(payload.profile);
    });
  }, [router]);

  const submitCheckout = useCallback(
    async (reuseKey: boolean): Promise<"done" | "waiting" | "failed"> => {
      if (!profile && !reuseKey) return "failed";
      const storedKey = window.sessionStorage.getItem(CHECKOUT_KEY_STORAGE);
      const key = reuseKey && storedKey ? storedKey : window.crypto.randomUUID();
      window.sessionStorage.setItem(CHECKOUT_KEY_STORAGE, key);
      setMessage("Preparing your secure report purchase…");
      let response: Response;
      try {
        response = await fetch("/api/reports/checkout", {
          method: "POST",
          headers: { "idempotency-key": key },
        });
      } catch {
        setMessage("Checkout is temporarily unreachable. Your cards and profile are unchanged.");
        return "failed";
      }
      const payload = (await response.json()) as {
        reportId?: string;
        reportStatus?: "pending" | "ready" | "failed";
        checkoutUrl?: string;
        status?: "pending" | "paid" | "failed" | "refunded" | "disputed";
        error?: string;
      };
      if (payload.reportId) {
        window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
        setCheckoutState(payload.reportStatus === "pending" ? "pending" : "idle");
        router.push(`/report/${payload.reportId}`);
        return "done";
      }
      if (payload.checkoutUrl) {
        window.location.assign(payload.checkoutUrl);
        return "done";
      }
      if (payload.status === "pending" || payload.status === "paid") {
        setCheckoutState("pending");
        setMessage(
          payload.status === "paid"
            ? "Payment is confirmed. Your report is entering the preparation queue."
            : "Payment confirmation is still arriving. This page will keep checking.",
        );
        return "waiting";
      }
      if (
        payload.status === "failed" ||
        payload.status === "refunded" ||
        payload.status === "disputed"
      ) {
        window.sessionStorage.removeItem(CHECKOUT_KEY_STORAGE);
        setCheckoutState("idle");
      }
      setMessage(payload.error ?? "Checkout could not be prepared. Try again shortly.");
      return "failed";
    },
    [profile, router],
  );

  useEffect(() => {
    if (profile === undefined || processedCheckoutReturn.current) return;
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout !== "success" && checkout !== "cancelled") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (checkout === "cancelled") {
      timer = setTimeout(() => {
        if (cancelled || processedCheckoutReturn.current) return;
        processedCheckoutReturn.current = true;
        window.history.replaceState({}, "", "/profile");
        setCheckoutState("cancelled");
        setMessage("Checkout was cancelled. No new charge was confirmed; you can resume securely.");
      }, 0);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }
    let attempts = 0;
    const poll = async () => {
      const outcome = await submitCheckout(true);
      attempts += 1;
      if (!cancelled && outcome === "waiting" && attempts < 40)
        timer = setTimeout(() => void poll(), 1_500);
      else if (!cancelled && outcome === "waiting")
        setMessage(
          "Your payment is retained and preparation is still pending. You can leave this page and return later.",
        );
    };
    timer = setTimeout(() => {
      if (cancelled || processedCheckoutReturn.current) return;
      processedCheckoutReturn.current = true;
      window.history.replaceState({}, "", "/profile");
      setCheckoutState("pending");
      setMessage("Payment received. Checking report preparation…");
      void poll();
    }, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [profile, submitCheckout]);
  if (profile === undefined)
    return (
      <main className="grid min-h-screen place-items-center">
        <LoadingState />
      </main>
    );
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <h1 className="text-5xl font-semibold">Private profile</h1>
      {!profile ? (
        <Panel className="mt-8">
          <p>No profile exists yet.</p>
        </Panel>
      ) : (
        <Panel className="mt-8">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-[#a99db5]">Birth name</dt>
              <dd>{profile.maskedName}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#a99db5]">Birth date</dt>
              <dd>{profile.birthDate}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#a99db5]">Birth time</dt>
              <dd>{profile.birthTimeProvided ? "Provided" : "Not provided"}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#a99db5]">Capability</dt>
              <dd>{profile.snapshot.completeness}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-[#a99db5]">
            Snapshot v{profile.snapshot.version}. Changes create a new snapshot and never
            reinterpret past readings.
          </p>
        </Panel>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => router.push("/onboarding")}>Update birth facts</Button>
        {profileReportsEnabled && (profile || checkoutState === "cancelled") && (
          <Button onClick={() => void submitCheckout(checkoutState === "cancelled")}>
            {checkoutState === "cancelled" ? "Resume secure checkout" : "Get full profile report"}
          </Button>
        )}
      </div>
      {message && (
        <p className="mt-4" role="alert">
          {message}
        </p>
      )}
      {profile && profileReportsEnabled ? (
        <Panel className="mt-8">
          <p className="text-sm tracking-[.18em] text-[#d8b56d] uppercase">Report preview</p>
          <h2 className="mt-2 text-2xl">What the private report covers</h2>
          <p className="mt-2 text-[#b8adc8]">
            This title-only preview shows the structure before purchase. Unavailable systems stay
            clearly unavailable in the report; StarGuidance never fills them with invented data.
          </p>
          <ul className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {PROFILE_REPORT_SECTION_PREVIEW.map((section) => (
              <li key={section.key}>{section.title}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {profile ? (
        <Panel className="mt-8 border-[#6f3341]">
          <h2 className="text-2xl">Delete private profile</h2>
          <p className="mt-2 text-[#b8adc8]">
            This removes every profile snapshot and its dependent readings. Paid order, entitlement,
            and generated-report records remain under the finance retention policy; your login and
            policy receipts remain so you can start over.
          </p>
          <div className="mt-4 max-w-sm">
            <Field
              autoComplete="off"
              label='Type "DELETE PROFILE"'
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              value={deleteConfirmation}
            />
          </div>
          <Button
            className="mt-4"
            disabled={deleting || deleteConfirmation !== "DELETE PROFILE"}
            onClick={async () => {
              setDeleting(true);
              setMessage(undefined);
              try {
                const response = await fetch("/api/profile", {
                  method: "DELETE",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ confirmation: deleteConfirmation }),
                });
                const payload = (await response.json()) as { error?: string };
                if (!response.ok) {
                  setMessage(payload.error ?? "The private profile could not be deleted.");
                  return;
                }
                setProfile(null);
                setDeleteConfirmation("");
                setMessage(
                  "Your private profile and dependent readings were deleted. Commerce records were retained under the finance policy.",
                );
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Deleting profile…" : "Delete private profile"}
          </Button>
        </Panel>
      ) : null}
    </main>
  );
}
