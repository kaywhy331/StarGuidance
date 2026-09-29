"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  birthProfileInputSchema,
  EARLIEST_BIRTH_DATE,
  type BirthProfileInput,
} from "@starguidance/contracts";
import { Button, Field, Panel } from "@starguidance/design-system";
import { useForm } from "react-hook-form";

import { sendJson } from "@/lib/client-request";
import { POLICY_VERSIONS } from "@/lib/policies";

const CONSENT_REQUIRED =
  "Please tick this box so we can keep your birth details privately and use them in your readings.";

function UnknownToggle({
  accessibleLabel,
  checked,
  onChange,
}: {
  accessibleLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="onboarding-unknown-toggle">
      <input
        aria-label={accessibleLabel}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        role="switch"
        type="checkbox"
      />
      <span aria-hidden="true" className="onboarding-unknown-toggle__track">
        <i />
      </span>
      <span>I don&apos;t know</span>
    </label>
  );
}

export function BirthProfileForm({ initialProfile }: { initialProfile?: BirthProfileInput }) {
  const [birthplaceUnknown, setBirthplaceUnknown] = useState(
    Boolean(initialProfile) && !initialProfile?.birthplace,
  );
  const [birthTimeUnknown, setBirthTimeUnknown] = useState(
    Boolean(initialProfile) && !initialProfile?.birthTime,
  );
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  /**
   * Some private saves take longer than others. Reassure the user after a few
   * seconds so a healthy wait is not mistaken for a frozen page.
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

  return (
    <Panel className="onboarding-workspace mt-10">
      <form
        className="onboarding-form"
        noValidate
        onSubmit={form.handleSubmit(
          async (profile) => {
            setSaveError(undefined);
            if (!consent) {
              setConsentError(true);
              document.getElementById("profile-consent")?.focus();
              return;
            }
            setStillWorking(false);
            const hint = setTimeout(() => setStillWorking(true), 6_000);
            try {
              const result = await sendJson(
                "/api/profile",
                "POST",
                {
                  ...profile,
                  birthplace: birthplaceUnknown ? undefined : profile.birthplace,
                  birthTime: birthTimeUnknown ? undefined : profile.birthTime,
                  consentVersion: POLICY_VERSIONS.profilePersonalization,
                },
                // Profile calculation can take a while on a cold start.
                { timeoutMs: 60_000 },
              );
              if (result.status === 401) return router.push("/sign-in?next=%2Fonboarding");
              if (result.status === 428) return router.push("/consent?next=%2Fonboarding");
              if (!result.ok) {
                setSaveError(result.error);
                return;
              }
              router.push("/readings");
            } finally {
              clearTimeout(hint);
              setStillWorking(false);
            }
          },
          () => {
            if (!consent) setConsentError(true);
          },
        )}
      >
        <div className="onboarding-form__stage">
          <fieldset className="onboarding-fieldset">
            <legend>Your birth details</legend>
            <p>
              Fields marked with * are required. Birthplace and birth time are optional—choose “I
              don&apos;t know” whenever that feels more accurate.
            </p>
            <div className="onboarding-details-grid">
              <Field
                autoComplete="name"
                error={error.fullBirthName?.message}
                hint="The full name you were given at birth. We use it privately for name numerology — it's encrypted and never shown in your readings."
                label="Full birth name *"
                required
                {...form.register("fullBirthName")}
              />
              <Field
                autoComplete="bday"
                error={error.birthDate?.message}
                hint="Enter your birthday as it appears on your birth record."
                label="Date of birth *"
                max={new Date().toISOString().slice(0, 10)}
                min={EARLIEST_BIRTH_DATE}
                required
                type="date"
                {...form.register("birthDate")}
              />
              <div className="onboarding-optional-field">
                <Field
                  disabled={birthplaceUnknown}
                  error={error.birthplace?.message}
                  hint={
                    birthplaceUnknown
                      ? "Marked as unknown."
                      : "Optional · city and country are enough."
                  }
                  label="Birth city / country"
                  placeholder="London, United Kingdom"
                  {...form.register("birthplace", {
                    setValueAs: (value: string) => value.trim() || undefined,
                  })}
                />
                <UnknownToggle
                  accessibleLabel="I don't know my birthplace"
                  checked={birthplaceUnknown}
                  onChange={(checked) => {
                    setBirthplaceUnknown(checked);
                    if (checked) {
                      form.setValue("birthplace", undefined, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.clearErrors("birthplace");
                    }
                  }}
                />
              </div>
              <div className="onboarding-optional-field">
                <Field
                  disabled={birthTimeUnknown}
                  error={error.birthTime?.message}
                  hint={
                    birthTimeUnknown
                      ? "Marked as unknown."
                      : "Optional · use the time shown on your birth record."
                  }
                  label="Birth time"
                  type="time"
                  {...form.register("birthTime", {
                    setValueAs: (value: string) => value.trim() || undefined,
                  })}
                />
                <UnknownToggle
                  accessibleLabel="I don't know the time of birth"
                  checked={birthTimeUnknown}
                  onChange={(checked) => {
                    setBirthTimeUnknown(checked);
                    if (checked) {
                      form.setValue("birthTime", undefined, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.clearErrors("birthTime");
                    }
                  }}
                />
              </div>
            </div>
            <div className="profile-privacy-promise">
              <span aria-hidden="true">◈</span>
              <p>
                <strong>Private by design.</strong> Your birth details are encrypted before storage
                and are never displayed publicly.
              </p>
            </div>
            <label className="profile-consent" data-invalid={consentError || undefined}>
              <input
                aria-describedby={consentError ? "profile-consent-error" : undefined}
                aria-invalid={consentError}
                checked={consent}
                id="profile-consent"
                onChange={(event) => {
                  setConsent(event.target.checked);
                  if (event.target.checked) setConsentError(false);
                }}
                required
                type="checkbox"
              />
              <span>
                I consent to the private use of my birth details and understand that tarot is
                reflective guidance, not factual prediction or professional advice.
              </span>
            </label>
            {consentError ? (
              <p className="profile-consent-error" id="profile-consent-error" role="alert">
                {CONSENT_REQUIRED}
              </p>
            ) : null}
            <div className="onboarding-form__actions">
              <Button disabled={submitting} type="submit">
                {submitting
                  ? "Saving privately…"
                  : initialProfile
                    ? "Save updated profile"
                    : "Save and continue"}
              </Button>
            </div>
            {submitting && stillWorking && (
              <p aria-live="polite" className="text-sm text-[#c9bfd4]">
                Still working — the first save can take a little longer. Thank you for waiting.
              </p>
            )}
            {saveError && (
              <p className="text-[#ffb7bd]" role="alert">
                {saveError}
              </p>
            )}
          </fieldset>
        </div>
      </form>
    </Panel>
  );
}
