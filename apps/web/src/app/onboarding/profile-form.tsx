"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { birthProfileInputSchema, type BirthProfileInput } from "@starguidance/contracts";
import { Button, Field, Panel } from "@starguidance/design-system";
import { useForm } from "react-hook-form";

export function BirthProfileForm() {
  const [consent, setConsent] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const router = useRouter();
  const form = useForm<BirthProfileInput>({
    resolver: zodResolver(birthProfileInputSchema),
    defaultValues: { fullBirthName: "", birthDate: "", birthplace: "", birthTime: "" },
  });
  const error = form.formState.errors;

  return (
    <Panel className="mt-10">
      <form
        className="grid gap-6"
        noValidate
        onSubmit={form.handleSubmit(async (profile) => {
          setSaveError(undefined);
          const response = await fetch("/api/profile", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...profile, consentVersion: "privacy-reflective-v1" }),
          });
          if (response.status === 401) return router.push("/sign-in");
          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            setSaveError(payload.error ?? "The private profile could not be calculated.");
            return;
          }
          router.push("/readings");
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
          {form.formState.isSubmitting ? "Calculating privately…" : "Check profile capability"}
        </Button>
        {saveError && (
          <p className="text-[#ffb7bd]" role="alert">
            {saveError}
          </p>
        )}
      </form>
    </Panel>
  );
}
