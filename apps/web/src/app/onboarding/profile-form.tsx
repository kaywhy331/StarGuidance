"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  birthProfileInputSchema,
  getProfileCompleteness,
  type BirthProfileInput,
} from "@starguidance/contracts";
import { Button, Field, Panel } from "@starguidance/design-system";
import { useForm, useWatch } from "react-hook-form";

export function BirthProfileForm() {
  const [completeness, setCompleteness] = useState<string>();
  const [hasPlace, setHasPlace] = useState(false);
  const [consent, setConsent] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const router = useRouter();
  const form = useForm<BirthProfileInput>({
    resolver: zodResolver(birthProfileInputSchema),
    defaultValues: { fullBirthName: "", birthDate: "", birthTime: { kind: "unknown" } },
  });
  const timeKind = useWatch({ control: form.control, name: "birthTime.kind" });
  const requiresContext = timeKind !== "unknown";
  const error = form.formState.errors;
  const label = useMemo(
    () => completeness?.replace(/([A-Z])/g, " $1").toLowerCase(),
    [completeness],
  );

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
          setCompleteness(getProfileCompleteness(profile));
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
          error={error.latinNameRendering?.message}
          hint="Only needed to confirm a Latin-letter rendering of a non-Latin birth name"
          label="Confirmed Latin-letter rendering (optional)"
          {...form.register("latinNameRendering", {
            setValueAs: (value: string) => value.trim() || undefined,
          })}
        />
        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium">Birth time</legend>
          <div className="flex flex-wrap gap-3">
            {(["unknown", "exact", "approximate"] as const).map((kind) => (
              <label className="rounded-full border border-white/15 px-4 py-2" key={kind}>
                <input
                  className="mr-2"
                  type="radio"
                  value={kind}
                  {...form.register("birthTime.kind")}
                />
                {kind[0]?.toUpperCase()}
                {kind.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
        {timeKind === "exact" && (
          <Field label="Exact birth time" type="time" {...form.register("birthTime.time")} />
        )}
        {timeKind === "approximate" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Earliest time" type="time" {...form.register("birthTime.start")} />
            <Field
              error={error.birthTime?.message}
              label="Latest time"
              type="time"
              {...form.register("birthTime.end")}
            />
          </div>
        )}
        <Field
          error={
            error.authoritativeTimeZone?.message ??
            (!hasPlace ? error.birthplace?.message : undefined)
          }
          hint={
            requiresContext
              ? "Required with a birth time unless a birthplace is supplied"
              : "Optional IANA timezone, for example America/Los_Angeles"
          }
          label="Authoritative birth timezone (optional)"
          placeholder="America/Los_Angeles"
          {...form.register("authoritativeTimeZone", {
            setValueAs: (value: string) => value.trim() || undefined,
          })}
        />
        <label className="flex items-center gap-3 text-sm">
          <input
            checked={hasPlace}
            onChange={(event) => {
              setHasPlace(event.target.checked);
              if (!event.target.checked) form.unregister("birthplace");
            }}
            type="checkbox"
          />
          Add birthplace (optional)
        </label>
        {hasPlace && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              error={error.birthplace?.message}
              hint="Optional when authoritative timezone is supplied"
              label="Birth city"
              {...form.register("birthplace.city")}
            />
            <Field
              label="Country code"
              maxLength={2}
              placeholder="US"
              {...form.register("birthplace.countryCode")}
            />
            <Field
              label="IANA timezone"
              placeholder="America/Los_Angeles"
              {...form.register("birthplace.timeZone")}
            />
          </div>
        )}
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
        {label && (
          <p aria-live="polite" className="rounded-2xl bg-[#221936] p-4">
            Profile capability: <strong>{label}</strong>. Missing details reduce scope, not access
            to tarot.
          </p>
        )}
      </form>
    </Panel>
  );
}
