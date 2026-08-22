"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, LoadingState, Panel } from "@starguidance/design-system";

import { POLICY_VERSIONS } from "@/lib/policies";

interface ConsentState {
  consents: { requiredCurrent: boolean };
  nextPath: string;
}

export function ConsentClient({ nextPath }: { nextPath?: string | undefined }) {
  const router = useRouter();
  const [state, setState] = useState<ConsentState>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/settings", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401)
        return router.replace(
          nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in",
        );
      const body = (await response.json()) as ConsentState & { error?: string };
      if (!response.ok) return setError(body.error ?? "Policy status could not be loaded.");
      if (body.consents.requiredCurrent) return router.replace(nextPath ?? body.nextPath);
      setState(body);
    });
  }, [nextPath, router]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "accept-required-policies",
          termsAccepted: form.get("termsAccepted") === "on",
          termsVersion: POLICY_VERSIONS.terms,
          privacyAccepted: form.get("privacyAccepted") === "on",
          privacyVersion: POLICY_VERSIONS.privacy,
          ageConfirmed: form.get("ageConfirmed") === "on",
          ageEligibilityVersion: POLICY_VERSIONS.ageEligibility,
        }),
      });
      const body = (await response.json()) as ConsentState & { error?: string };
      if (!response.ok) return setError(body.error ?? "Policy acceptance could not be saved.");
      router.replace(nextPath ?? body.nextPath);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-xl place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Policy review</p>
        <h1 className="mt-3 text-4xl font-semibold">Before you continue</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          A required service policy has a newer version. Review and accept the current versions to
          create profiles or readings. Optional marketing consent remains separate in Account
          settings.
        </p>
        {!state && !error ? <LoadingState /> : null}
        {state ? (
          <form className="mt-6 grid gap-4" onSubmit={accept}>
            <label className="flex items-start gap-3 text-sm leading-6">
              <input name="termsAccepted" required type="checkbox" />
              <span>
                I accept the current <Link href="/terms">Terms</Link>.
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-6">
              <input name="privacyAccepted" required type="checkbox" />
              <span>
                I have read the current <Link href="/privacy">Privacy Notice</Link>.
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-6">
              <input name="ageConfirmed" required type="checkbox" />
              <span>I confirm that I am at least 18 years old.</span>
            </label>
            <Button disabled={saving} type="submit">
              {saving ? "Saving…" : "Accept and continue"}
            </Button>
          </form>
        ) : null}
        {error ? (
          <p className="mt-5 text-[#ffb7bd]" role="alert">
            {error}
          </p>
        ) : null}
      </Panel>
    </main>
  );
}
