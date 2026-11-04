"use client";

import { setMotionPreference } from "@/lib/motion-preference";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, LoadingState, Panel } from "@starguidance/design-system";

import { signInPathFor } from "@/lib/account-return";
import { requestJson, sendJson } from "@/lib/client-request";
import { POLICY_VERSIONS } from "@/lib/policies";
import { useReadingPreferences } from "@/lib/reading-preferences";
import { SettingSwitch, SettingsNav } from "../settings-nav";
import {
  PERSONALIZE_KEY,
  personalizationEnabledOnDevice,
  REVERSALS_KEY,
  reversalsEnabledOnDevice,
  writeDeviceBoolean,
} from "./reading-experience";

interface AccountSettingsPayload {
  settings: { displayName: string; soundEnabled: boolean; reducedMotion: boolean };
  consents: { requiredCurrent: boolean; marketingAccepted: boolean };
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; payload: AccountSettingsPayload };

export default function AccountSettingsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [reversals, setReversals] = useState(true);
  const [personalize, setPersonalize] = useState(true);
  const { ambience, narration, toggleAmbience, toggleNarration } = useReadingPreferences();
  const payload = state.phase === "ready" ? state.payload : undefined;

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    const result = await requestJson<AccountSettingsPayload>("/api/settings", {
      cache: "no-store",
    });
    if (!result.ok) {
      if (result.status === 401) {
        router.replace(signInPathFor("/settings/account"));
        return;
      }
      setState({ phase: "error", message: result.error });
      return;
    }
    setReversals(reversalsEnabledOnDevice());
    setPersonalize(personalizationEnabledOnDevice());
    setState({ phase: "ready", payload: result.data });
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await sendJson<AccountSettingsPayload>("/api/settings", "PATCH", {
        action: "update-account-settings",
        displayName: form.get("displayName"),
        soundEnabled: form.get("soundEnabled") === "on",
        reducedMotion: form.get("reducedMotion") === "on",
        marketingAccepted: form.get("marketingAccepted") === "on",
        marketingVersion: POLICY_VERSIONS.marketing,
      });
      if (!result.ok) {
        if (result.status === 401) {
          router.replace(signInPathFor("/settings/account"));
          return;
        }
        setError(result.error);
        return;
      }
      setState({ phase: "ready", payload: result.data });
      setMotionPreference(result.data.settings.reducedMotion);
      setNotice("Account settings saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <p className="page-eyebrow">Settings</p>
        <h1>Account</h1>
        <p>Your name, how readings look and sound, and the emails you’d like.</p>
      </header>
      <SettingsNav />
      {state.phase === "loading" ? <LoadingState label="Opening your settings…" /> : null}
      {state.phase === "error" ? (
        <Panel className="account-state-panel" role="alert">
          <h2>We couldn’t open your settings</h2>
          <p>{state.message}</p>
          <div className="account-state-panel__actions">
            <Button onClick={() => void load()}>Try again</Button>
            <Link href="/readings">Back to readings</Link>
          </div>
        </Panel>
      ) : null}
      {payload ? (
        <form className="settings-form" onSubmit={submit}>
          <Panel className="settings-group">
            <h2>Your name</h2>
            <p>
              What we call you during readings. It’s separate from the birth name in your profile.
            </p>
            <Field
              defaultValue={payload.settings.displayName}
              label="Display name"
              maxLength={80}
              name="displayName"
              required
            />
          </Panel>

          <Panel className="settings-group">
            <h2>Reading experience</h2>
            <p>Saved to your account, so they follow you to any device.</p>
            <SettingSwitch
              defaultChecked={payload.settings.reducedMotion}
              description="Cards fade into place instead of flying and flipping. Your device’s reduce-motion setting always wins."
              label="Reduce card and scene motion"
              name="reducedMotion"
            />
            <SettingSwitch
              defaultChecked={payload.settings.soundEnabled}
              description="Soft shuffle, deal, and reveal sounds. This is one of the three sound layers you can switch on during a reading."
              label="Card sound effects"
              name="soundEnabled"
            />
            <h3 className="settings-group__subhead">On this device</h3>
            <p>These change straight away and apply only to this browser.</p>
            <SettingSwitch
              checked={ambience}
              description="A quiet room tone that shifts with each part of the reading."
              label="Ambient soundscape"
              onChange={() => toggleAmbience()}
            />
            <SettingSwitch
              checked={narration}
              description="Shows a play button so you can hear a section read aloud. Only the section you play is sent to our voice provider."
              label="Spoken narration"
              onChange={() => toggleNarration()}
            />
            <SettingSwitch
              checked={reversals}
              description="Cards can land upside down, adding a second shade of meaning."
              label="Reversed cards"
              onChange={(next) => {
                setReversals(next);
                writeDeviceBoolean(REVERSALS_KEY, next);
              }}
            >
              <details className="settings-explainer">
                <summary>What’s a reversal?</summary>
                <p>
                  A reversed card is one that appears upside down. It usually points to the same
                  theme turned inward, delayed, or blocked — not simply the opposite. Turn this off
                  if you’d rather every card be read upright.
                </p>
              </details>
            </SettingSwitch>
            <SettingSwitch
              checked={personalize}
              description="Let readings draw on a small, relevant part of your birth profile. Turn off for pure tarot."
              label="Personalize with my birth profile"
              onChange={(next) => {
                setPersonalize(next);
                writeDeviceBoolean(PERSONALIZE_KEY, next);
              }}
            />
          </Panel>

          <Panel className="settings-group">
            <h2>Email</h2>
            <SettingSwitch
              defaultChecked={payload.consents.marketingAccepted}
              description="Occasional product news. Optional, separate from the service, and you can turn it off here any time."
              label="Send occasional product news"
              name="marketingAccepted"
            />
            {!payload.consents.requiredCurrent ? (
              <p className="settings-group__warning">
                Our terms or privacy notice changed. <Link href="/consent">Review them</Link> to
                keep using StarGuidance.
              </p>
            ) : null}
          </Panel>

          <div className="settings-actions">
            <Button disabled={saving} type="submit">
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Link href="/settings/privacy">Privacy and your data →</Link>
          </div>
          {notice ? <p role="status">{notice}</p> : null}
          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </main>
  );
}
