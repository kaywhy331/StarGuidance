"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, LoadingState, Panel } from "@starguidance/design-system";

import { POLICY_VERSIONS } from "@/lib/policies";

interface AccountSettingsPayload {
  settings: { displayName: string; soundEnabled: boolean; reducedMotion: boolean };
  consents: { requiredCurrent: boolean; marketingAccepted: boolean };
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<AccountSettingsPayload>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/settings", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) return router.replace("/sign-in");
      const body = (await response.json()) as AccountSettingsPayload & { error?: string };
      if (!response.ok) return setError(body.error ?? "Account settings could not be loaded.");
      setPayload(body);
    });
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update-account-settings",
          displayName: form.get("displayName"),
          soundEnabled: form.get("soundEnabled") === "on",
          reducedMotion: form.get("reducedMotion") === "on",
          marketingAccepted: form.get("marketingAccepted") === "on",
          marketingVersion: POLICY_VERSIONS.marketing,
        }),
      });
      const body = (await response.json()) as AccountSettingsPayload & { error?: string };
      if (!response.ok) return setError(body.error ?? "Account settings could not be saved.");
      setPayload(body);
      setNotice("Account settings saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Account</p>
      <h1 className="mt-3 text-5xl font-semibold">Your settings</h1>
      {!payload && !error ? <LoadingState /> : null}
      {payload ? (
        <form className="mt-8 grid gap-5" onSubmit={submit}>
          <Panel>
            <h2 className="text-2xl">Display identity</h2>
            <p className="mt-2 text-sm leading-6 text-[#b8adc8]">
              This is the name used around the reading experience. It stays separate from the
              encrypted birth name used for profile calculations.
            </p>
            <Field
              className="mt-4"
              defaultValue={payload.settings.displayName}
              label="Display name"
              maxLength={80}
              name="displayName"
              required
            />
          </Panel>
          <Panel>
            <h2 className="text-2xl">Reading preferences</h2>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6">
              <input
                defaultChecked={payload.settings.reducedMotion}
                name="reducedMotion"
                type="checkbox"
              />
              Reduce card and scene motion by default.
            </label>
            <label className="mt-3 flex items-start gap-3 text-sm leading-6">
              <input
                defaultChecked={payload.settings.soundEnabled}
                name="soundEnabled"
                type="checkbox"
              />
              Enable optional reading sounds by default.
            </label>
          </Panel>
          <Panel>
            <h2 className="text-2xl">Optional email</h2>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6">
              <input
                defaultChecked={payload.consents.marketingAccepted}
                name="marketingAccepted"
                type="checkbox"
              />
              Send occasional product news. This consent is independent from the service and can be
              withdrawn here at any time.
            </label>
            {!payload.consents.requiredCurrent ? (
              <p className="mt-4 text-sm text-[#ffcf8c]">
                Current service policies need your review. <Link href="/consent">Review them</Link>.
              </p>
            ) : null}
          </Panel>
          <div className="flex flex-wrap items-center gap-4">
            <Button disabled={saving} type="submit">
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Link className="underline" href="/settings/privacy">
              Privacy and deletion controls
            </Link>
          </div>
          {notice ? (
            <p aria-live="polite" className="text-emerald-100">
              {notice}
            </p>
          ) : null}
        </form>
      ) : null}
      {error ? (
        <p className="mt-6 text-[#ffb7bd]" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
