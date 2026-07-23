"use client";

import { useMemo, useState } from "react";
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
  const form = useForm<BirthProfileInput>({
    resolver: zodResolver(birthProfileInputSchema),
    defaultValues: { fullBirthName: "", birthDate: "", birthTime: { kind: "unknown" } },
  });
  const timeKind = useWatch({ control: form.control, name: "birthTime.kind" });
  const requiresPlace = timeKind !== "unknown";
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
        onSubmit={form.handleSubmit((profile) => setCompleteness(getProfileCompleteness(profile)))}
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
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            error={error.birthplace?.message}
            hint={requiresPlace ? "Required with a birth time" : "Optional"}
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
        <p className="text-sm leading-6 text-[#a99db5]">
          This form validates locally for the prototype. It does not persist birth data until an
          authenticated encrypted profile store is configured.
        </p>
        <Button type="submit">Check profile capability</Button>
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
