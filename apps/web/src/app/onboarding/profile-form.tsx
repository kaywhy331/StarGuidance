"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  birthProfileInputSchema,
  type BirthProfileInput,
  type ProfileCompleteness,
} from "@starguidance/contracts";
import { Button, Field, Panel } from "@starguidance/design-system";
import { useForm, useWatch } from "react-hook-form";

import { POLICY_VERSIONS } from "@/lib/policies";

export function BirthProfileForm({ initialProfile }: { initialProfile?: BirthProfileInput }) {
  const [step, setStep] = useState<"essentials" | "context">("essentials");
  const [consent, setConsent] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  /**
   * A calculation service that has been idle takes noticeably longer to answer
   * its first request, and the client waits through that rather than failing.
   * Without a word after a few seconds a correct wait is indistinguishable from
   * a frozen page, and someone reasonably gives up on a profile that was about
   * to succeed.
   */
  const [stillWorking, setStillWorking] = useState(false);
  const router = useRouter();
  const form = useForm<BirthProfileInput>({
    resolver: zodResolver(birthProfileInputSchema),
    defaultValues: initialProfile ?? {
      fullBirthName: "",
      birthDate: "",
      birthplace: "",
      birthTime: "",
    },
  });
  const error = form.formState.errors;
  const submitting = form.formState.isSubmitting;
  const birthplace = useWatch({ control: form.control, name: "birthplace" })?.trim();
  const birthTime = useWatch({ control: form.control, name: "birthTime" })?.trim();
  const completeness: ProfileCompleteness =
    birthplace && birthTime ? "complete" : birthplace ? "locationEnhanced" : "core";
  const completenessValue = { core: 1, locationEnhanced: 2, complete: 3 }[completeness];
  const capability = {
    core: {
      label: "Core profile",
      summary: "Stable date-based insight is available.",
      available: ["Name numerology", "Dreamspell signature", "Stable date traits"],
      unavailable: "Chart angles, houses, and time-sensitive placements remain unavailable.",
    },
    locationEnhanced: {
      label: "Location enhanced",
      summary: "Place adds historical and date-boundary context.",
      available: ["Core profile", "Location context", "Better date-boundary handling"],
      unavailable: "Chart angles, houses, and the BaZi hour pillar still need birth time.",
    },
    complete: {
      label: "Context complete",
      summary: "Place and time are ready for validated engines.",
      available: ["Core profile", "Historical time context", "Time-sensitive capability"],
      unavailable: "Unsupported calculations stay clearly unavailable rather than being guessed.",
    },
  }[completeness];

  return (
    <Panel className="onboarding-workspace mt-10">
      <form
        className="onboarding-form"
        noValidate
        onSubmit={form.handleSubmit(async (profile) => {
          setSaveError(undefined);
          setStillWorking(false);
          const hint = setTimeout(() => setStillWorking(true), 6_000);
          try {
            const response = await fetch("/api/profile", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ...profile,
                consentVersion: POLICY_VERSIONS.profilePersonalization,
              }),
            });
            if (response.status === 401) return router.push("/sign-in");
            if (response.status === 428) return router.push("/consent");
            if (!response.ok) {
              const payload = (await response.json()) as { error?: string };
              setSaveError(payload.error ?? "The private profile could not be calculated.");
              return;
            }
            router.push("/readings");
          } finally {
            clearTimeout(hint);
            setStillWorking(false);
          }
        })}
      >
        <aside aria-live="polite" className="profile-capability" data-completeness={completeness}>
          <div aria-hidden="true" className="profile-capability__orb">
            <span />
          </div>
          <p>Your profile now</p>
          <h2>{capability.label}</h2>
          <p>{capability.summary}</p>
          <div
            aria-label={`${capability.label} completeness`}
            aria-valuemax={3}
            aria-valuemin={1}
            aria-valuenow={completenessValue}
            className="profile-capability__meter"
            role="meter"
          >
            <i />
            <i />
            <i />
          </div>
          <ul>
            {capability.available.map((item) => (
              <li key={item}>
                <span aria-hidden="true">✓</span> {item}
              </li>
            ))}
          </ul>
          <small>
            {birthTime && !birthplace ? "Your birth time can be saved without a place. " : ""}
            {capability.unavailable}
          </small>
        </aside>

        <div className="onboarding-form__stage">
          <ol aria-label="Profile setup progress" className="onboarding-progress">
            <li aria-current={step === "essentials" ? "step" : undefined}>
              <span>01</span> Essentials
            </li>
            <li aria-current={step === "context" ? "step" : undefined}>
              <span>02</span> Optional context
            </li>
          </ol>

          {step === "essentials" ? (
            <fieldset className="onboarding-fieldset">
              <legend>Start with the two facts you know</legend>
              <p>These create a useful Core profile. Nothing else is required to continue.</p>
              <Field
                autoComplete="name"
                error={error.fullBirthName?.message}
                hint="Use the name given at birth. It stays encrypted."
                label="Full birth name"
                {...form.register("fullBirthName")}
              />
              <Field
                error={error.birthDate?.message}
                hint="Used for stable date-based systems; never shown in a reading prompt."
                label="Date of birth"
                max={new Date().toISOString().slice(0, 10)}
                type="date"
                {...form.register("birthDate")}
              />
              <Button
                onClick={async () => {
                  const ready = await form.trigger(["fullBirthName", "birthDate"], {
                    shouldFocus: true,
                  });
                  if (ready) setStep("context");
                }}
                type="button"
              >
                Continue to optional context <span aria-hidden="true">→</span>
              </Button>
              <button className="onboarding-why" onClick={() => setStep("context")} type="button">
                See what optional details can add
              </button>
            </fieldset>
          ) : (
            <fieldset className="onboarding-fieldset">
              <legend>Add detail only if you want to</legend>
              <p>
                Both fields are optional. Leave either blank; StarGuidance never invents missing
                context or asks you to judge whether a time is exact.
              </p>
              <div className="onboarding-optional-grid">
                <Field
                  error={error.birthplace?.message}
                  hint="Optional · city and country are enough"
                  label="Birth city / country"
                  placeholder="London, United Kingdom"
                  {...form.register("birthplace", {
                    setValueAs: (value: string) => value.trim() || undefined,
                  })}
                />
                <Field
                  error={error.birthTime?.message}
                  hint="Optional · accepted with or without a birthplace"
                  label="Birth time"
                  type="time"
                  {...form.register("birthTime", {
                    setValueAs: (value: string) => value.trim() || undefined,
                  })}
                />
              </div>
              <div className="profile-privacy-promise">
                <span aria-hidden="true">◈</span>
                <p>
                  <strong>Encrypted before storage.</strong> Raw birth details never enter URLs,
                  analytics, or the AI narration request.
                </p>
              </div>
              <label className="profile-consent">
                <input
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  required
                  type="checkbox"
                />
                <span>
                  I consent to private profile calculation and understand that tarot is reflective
                  guidance, not factual prediction or professional advice.
                </span>
              </label>
              <div className="onboarding-form__actions">
                <Button onClick={() => setStep("essentials")} type="button" variant="quiet">
                  ← Back
                </Button>
                <Button disabled={!consent || submitting} type="submit">
                  {submitting
                    ? "Calculating privately…"
                    : initialProfile
                      ? "Save new profile snapshot"
                      : "Check profile capability"}
                </Button>
              </div>
              {submitting && stillWorking && (
                <p aria-live="polite" className="text-sm text-[#c9bfd4]">
                  Still working. The private calculation service can take a moment to start up.
                </p>
              )}
              {saveError && (
                <p className="text-[#ffb7bd]" role="alert">
                  {saveError}
                </p>
              )}
            </fieldset>
          )}
        </div>
      </form>
    </Panel>
  );
}
