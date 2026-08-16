"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { birthProfileInputSchema, type BirthProfileInput } from "@starguidance/contracts";
import { Button, Field, Panel } from "@starguidance/design-system";
import { useForm } from "react-hook-form";

import { POLICY_VERSIONS } from "@/lib/policies";

export function BirthProfileForm({ initialProfile }: { initialProfile?: BirthProfileInput }) {
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

  return (
    <Panel className="mt-10">
      <form
        className="grid gap-6"
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
        <Field
          autoComplete="name"
          error={error.fullBirthName?.message}
          label="Full birth name"
          {...form.register("fullBirthName")}
        />
        <Field
          error={error.birthDate?.message}
          label="Date of birth"
          max={new Date().toISOString().slice(0, 10)}
          type="date"
          {...form.register("birthDate")}
        />
        <Field
          error={error.birthplace?.message}
          hint="Optional"
          label="Birth city / country"
          placeholder="London, United Kingdom"
          {...form.register("birthplace", {
            setValueAs: (value: string) => value.trim() || undefined,
          })}
        />
        <Field
          error={error.birthTime?.message}
          hint="Optional"
          label="Birth time"
          type="time"
          {...form.register("birthTime", {
            setValueAs: (value: string) => value.trim() || undefined,
          })}
        />
        <p className="text-sm leading-6 text-[#a99db5]">
          Raw details are encrypted server-side and never sent to analytics or placed in a URL.
        </p>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            checked={consent}
            className="mt-1"
            onChange={(event) => setConsent(event.target.checked)}
            required
            type="checkbox"
          />
          I consent to private profile calculation and understand that tarot is reflective guidance,
          not factual prediction or professional advice.
        </label>
        <Button disabled={!consent || form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting
            ? "Calculating privately…"
            : initialProfile
              ? "Save new profile snapshot"
              : "Check profile capability"}
        </Button>
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
      </form>
    </Panel>
  );
}
