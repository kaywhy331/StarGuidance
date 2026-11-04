"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Panel, PasswordField } from "@starguidance/design-system";

import { signInPathFor } from "@/lib/account-return";
import { CONNECTION_LOST_MESSAGE, sendJson } from "@/lib/client-request";
import { SettingsNav } from "../settings-nav";

type ExportState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "downloaded" }
  | { phase: "error"; message: string };

function exportFileName() {
  return `starguidance-export-${new Date().toISOString().slice(0, 10)}.json`;
}

export default function PrivacyPage() {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const [exportState, setExportState] = useState<ExportState>({ phase: "idle" });

  async function downloadExport() {
    setExportState({ phase: "preparing" });
    let response: Response;
    try {
      response = await fetch("/api/privacy/export", {
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      setExportState({ phase: "error", message: CONNECTION_LOST_MESSAGE });
      return;
    }
    if (response.status === 401) {
      router.push(signInPathFor("/settings/privacy"));
      return;
    }
    if (response.status === 429) {
      setExportState({
        phase: "error",
        message:
          "You’ve downloaded your data a few times recently. Please try again in about an hour.",
      });
      return;
    }
    if (!response.ok) {
      setExportState({
        phase: "error",
        message: "We couldn’t prepare your data just now. Please try again in a moment.",
      });
      return;
    }
    try {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFileName();
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExportState({ phase: "downloaded" });
    } catch {
      setExportState({
        phase: "error",
        message: "The download was interrupted. Please try again.",
      });
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <p className="page-eyebrow">Settings</p>
        <h1>Privacy</h1>
        <p>Download everything we hold about you, or delete it.</p>
      </header>
      <SettingsNav />

      <Panel className="settings-group">
        <h2>Download your data</h2>
        <p>
          A readable copy of everything in your account: your profile and birth details, the people
          you’ve saved, your readings and follow-ups, feedback, purchases and atlases (including any
          you no longer have access to), and an activity log of changes made to your account.
        </p>
        <div className="settings-actions">
          <Button
            disabled={exportState.phase === "preparing"}
            onClick={() => void downloadExport()}
            variant="secondary"
          >
            {exportState.phase === "preparing" ? "Preparing your data…" : "Download my data"}
          </Button>
        </div>
        <p className="settings-inline-status" role="status">
          {exportState.phase === "downloaded"
            ? "Downloaded. Check your browser’s downloads for the file."
            : ""}
        </p>
        {exportState.phase === "error" ? (
          <p className="settings-error" role="alert">
            {exportState.message}
          </p>
        ) : null}
      </Panel>

      <Panel className="settings-group">
        <h2>Delete part of your data</h2>
        <p>
          You can delete a single reading from your history, or delete your birth profile together
          with the readings made from it. Either way your login stays, and any pattern atlases you
          purchased stay available along with their receipts.
        </p>
        <div className="settings-links">
          <Link href="/history">Manage readings →</Link>
          <Link href="/profile">Manage your profile →</Link>
          <Link href="/people">Manage saved people →</Link>
        </div>
      </Panel>

      <Panel className="settings-group settings-group--danger">
        <h2>Delete your account</h2>
        <p>
          This permanently deletes your sign-in identity and the data held in your account: your
          profile, saved people, saved readings, settings, and purchased atlases with their
          receipts. It can’t be undone. We keep only an anonymous note that a deletion happened; our
          payment processor keeps its own records of past payments.
        </p>
        <p>
          A free guest reading kept in a browser is a separate copy. Deleting your account doesn’t
          clear it from this or any other browser; it stops working on its own seven days after it
          was made, and clearing this browser’s site data removes it sooner.
        </p>
        <p>To confirm, enter your current password and type DELETE.</p>
        <div className="settings-danger-fields">
          <PasswordField
            autoComplete="current-password"
            id="delete-account-password"
            label="Current password"
            maxLength={72}
            minLength={12}
            name="currentPassword"
            onChange={(event) => setPassword(event.target.value)}
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
          className="settings-danger-button"
          disabled={deleting || confirmation !== "DELETE" || password.length < 12}
          onClick={async () => {
            setDeleting(true);
            setError(undefined);
            try {
              const result = await sendJson("/api/account", "DELETE", { confirmation, password });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              router.replace("/goodbye");
              router.refresh();
            } finally {
              setDeleting(false);
            }
          }}
          variant="danger"
        >
          {deleting ? "Deleting your account…" : "Delete my account"}
        </Button>
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
      </Panel>

      <p className="settings-footer-link">
        <Link href="/settings/account">← Account settings</Link>
      </p>
    </main>
  );
}
