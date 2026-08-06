"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Panel } from "@starguidance/design-system";

export default function PrivacyPage() {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <h1 className="text-5xl font-semibold [overflow-wrap:anywhere]">Privacy controls</h1>
      <Panel className="mt-8">
        <h2 className="text-2xl">Export</h2>
        <p className="mt-2 text-[#b8adc8]">
          Download a readable JSON copy without internal prompts or security logs.
        </p>
        <a
          className="mt-4 inline-flex rounded-full border border-white/15 px-5 py-3"
          download="starguidance-export.json"
          href="/api/privacy/export"
        >
          Export my data
        </a>
      </Panel>
      <Panel className="mt-5">
        <h2 className="text-2xl">Delete selected data</h2>
        <p className="mt-2 text-[#b8adc8]">
          Delete one reading from history, or remove the private profile and all records that depend
          on its snapshots without deleting your login.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link className="underline" href="/history">
            Manage readings
          </Link>
          <Link className="underline" href="/profile">
            Manage private profile
          </Link>
        </div>
      </Panel>
      <Panel className="mt-5 border-[#6f3341]">
        <h2 className="text-2xl">Delete account</h2>
        <p className="mt-2 text-[#b8adc8]">
          This permanently removes your login identity, profile snapshots, readings, reports,
          settings, and other user-owned records. Re-enter your password and type DELETE to confirm.
        </p>
        <div className="mt-4 grid gap-4">
          <Field
            autoComplete="current-password"
            label="Current password"
            maxLength={72}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
          <Field
            autoComplete="off"
            label='Type "DELETE"'
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
        </div>
        <Button
          className="mt-4"
          disabled={deleting || confirmation !== "DELETE" || password.length < 12}
          onClick={async () => {
            setDeleting(true);
            setError(undefined);
            try {
              const response = await fetch("/api/account", {
                method: "DELETE",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ confirmation, password }),
              });
              const payload = (await response.json()) as { error?: string };
              if (!response.ok) {
                setError(payload.error ?? "The account could not be deleted.");
                return;
              }
              router.push("/");
              router.refresh();
            } finally {
              setDeleting(false);
            }
          }}
        >
          {deleting ? "Deleting account…" : "Delete my account"}
        </Button>
        {error ? (
          <p className="mt-4 text-[#ffb7bd]" role="alert">
            {error}
          </p>
        ) : null}
      </Panel>
    </main>
  );
}
