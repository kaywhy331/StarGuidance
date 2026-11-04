"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@starguidance/design-system";

import { signInPathFor } from "@/lib/account-return";
import { requestJson, sendJson } from "@/lib/client-request";
import { ConfirmDialog } from "../history/confirm-dialog";

interface PersonProfile {
  id: string;
  snapshotId: string;
  version: number;
  name: string;
  mention: string;
  /** The original full-name handle, which keeps working when a shorter one is shown. */
  fullMention?: string;
  birthDate: string;
  birthplace?: string;
  birthTime?: string;
  completeness: "core" | "locationEnhanced" | "complete";
  updatedAt: string;
}

interface PersonDraft {
  profileId?: string;
  fullBirthName: string;
  birthDate: string;
  birthplace: string;
  birthTime: string;
  permissionConfirmed: boolean;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; profiles: PersonProfile[]; limit: number };

const emptyDraft: PersonDraft = {
  fullBirthName: "",
  birthDate: "",
  birthplace: "",
  birthTime: "",
  permissionConfirmed: false,
};

function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export default function PeoplePage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [draft, setDraft] = useState<PersonDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<PersonProfile>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const profiles = state.phase === "ready" ? state.profiles : undefined;
  const limit = state.phase === "ready" ? state.limit : 20;

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState({ phase: "loading" });
      const result = await requestJson<{ profiles?: PersonProfile[]; limit?: number }>(
        "/api/people",
        { cache: "no-store" },
      );
      if (!result.ok) {
        if (result.status === 401) {
          router.push(signInPathFor("/people"));
          return;
        }
        if (quiet) setError(result.error);
        else setState({ phase: "error", message: result.error });
        return;
      }
      setState({
        phase: "ready",
        profiles: result.data.profiles ?? [],
        limit: result.data.limit ?? 20,
      });
    },
    [router],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await sendJson<{
        profile?: PersonProfile;
        changedMentions?: { from: string; to: string }[];
      }>("/api/people", "POST", {
        ...(draft.profileId ? { profileId: draft.profileId } : {}),
        fullBirthName: draft.fullBirthName,
        birthDate: draft.birthDate,
        ...(draft.birthplace.trim() ? { birthplace: draft.birthplace.trim() } : {}),
        ...(draft.birthTime ? { birthTime: draft.birthTime } : {}),
        permissionConfirmed: draft.permissionConfirmed,
      });
      if (result.status === 401) return router.push(signInPathFor("/people"));
      if (result.status === 428) return router.push("/consent?next=/people");
      if (!result.ok) return setError(result.error);
      const saved = result.data.profile;
      const renamed = (result.data.changedMentions ?? [])
        .map(({ from, to }) => `${from} is now ${to}`)
        .join(", ");
      setNotice(
        (draft.profileId
          ? `${saved?.name ?? "Their profile"} was updated for future readings.`
          : `${saved?.name ? firstName(saved.name) : "They"} can now be mentioned as ${saved?.mention ?? "their handle"} in a question.`) +
          (renamed ? ` To tell people apart, ${renamed} (the full-name handle still works).` : ""),
      );
      setDraft(emptyDraft);
      await load(true);
    } finally {
      setSaving(false);
    }
  };

  const copyHandle = async (mention: string) => {
    try {
      await navigator.clipboard.writeText(mention);
      setCopied(mention);
      setTimeout(() => setCopied((current) => (current === mention ? undefined : current)), 2_000);
    } catch {
      setError(`Copy didn’t work here — you can type ${mention} into your question instead.`);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const result = await sendJson("/api/people", "DELETE", { profileId: target.id });
      if (!result.ok) return setDeleteError(result.error);
      if (draft.profileId === target.id) setDraft(emptyDraft);
      setPendingDelete(undefined);
      setNotice(`${target.name}’s profile was deleted.`);
      await load(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="people-vault-page">
      <header className="people-vault-hero">
        <p>People</p>
        <h1>People in your life</h1>
        <span>
          Save someone close to you — with their permission — and mention them in a question, like
          “How can I support @maya this month?”. Their birth details help the reading understand
          them; they never change which cards you draw.
        </span>
      </header>

      <div className="people-vault-layout">
        <section aria-label="Person profile editor" className="people-profile-editor">
          <div>
            <p>{draft.profileId ? "Update profile" : "New profile"}</p>
            <h2>{draft.profileId ? `Update ${firstName(draft.fullBirthName)}` : "Add someone"}</h2>
          </div>
          <form onSubmit={submit}>
            <label>
              <span>Full birth name *</span>
              <input
                autoComplete="off"
                maxLength={200}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, fullBirthName: event.target.value }))
                }
                required
                value={draft.fullBirthName}
              />
            </label>
            <label>
              <span>Date of birth *</span>
              <input
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, birthDate: event.target.value }))
                }
                required
                type="date"
                value={draft.birthDate}
              />
            </label>
            <label>
              <span>Birth city / country</span>
              <input
                maxLength={200}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, birthplace: event.target.value }))
                }
                placeholder="Optional"
                value={draft.birthplace}
              />
            </label>
            <label>
              <span>Birth time</span>
              <input
                onChange={(event) =>
                  setDraft((current) => ({ ...current, birthTime: event.target.value }))
                }
                type="time"
                value={draft.birthTime}
              />
            </label>
            <label className="people-permission-check">
              <input
                checked={draft.permissionConfirmed}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    permissionConfirmed: event.target.checked,
                  }))
                }
                required
                type="checkbox"
              />
              <span>
                I have this person&apos;s permission to store their birth details privately.
              </span>
            </label>
            <div className="people-editor-actions">
              {draft.profileId ? (
                <button onClick={() => setDraft(emptyDraft)} type="button">
                  Cancel
                </button>
              ) : null}
              <button disabled={!draft.permissionConfirmed || saving} type="submit">
                {saving
                  ? "Working out their profile…"
                  : draft.profileId
                    ? "Save update"
                    : "Add person"}
              </button>
            </div>
            {saving ? (
              <p className="people-saving-hint" role="status">
                We’re calculating their profile from these birth details. The details are encrypted
                and only a short summary is ever used in a reading. This takes a few seconds.
              </p>
            ) : null}
          </form>
          {error ? <p role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
        </section>

        <section aria-label="Saved people" className="people-profile-list">
          <header>
            <div>
              <p>Only visible to you</p>
              <h2>Saved people</h2>
            </div>
            <span>
              {profiles?.length ?? 0} of {limit}
            </span>
          </header>
          {state.phase === "loading" ? <p role="status">Opening your saved people…</p> : null}
          {state.phase === "error" ? (
            <div className="account-state-panel" role="alert">
              <h3>We couldn’t load your saved people</h3>
              <p>{state.message}</p>
              <div className="account-state-panel__actions">
                <Button onClick={() => void load()}>Try again</Button>
                <Link href="/readings">Back to readings</Link>
              </div>
            </div>
          ) : null}
          {profiles?.length === 0 ? (
            <div className="people-empty-state">
              <span aria-hidden="true">✦</span>
              <p>No one saved yet.</p>
              <p>
                When you add someone, you&apos;ll get a short handle to use in questions — for
                example, “How can I support @maya this month?”. The reading then considers their
                nature alongside yours.
              </p>
            </div>
          ) : null}
          {profiles?.map((profile) => (
            <article key={profile.id}>
              <div>
                <p>{profile.name}</p>
                <div className="people-handle">
                  <code>{profile.mention}</code>
                  <button
                    aria-label={`Copy ${profile.mention}`}
                    onClick={() => void copyHandle(profile.mention)}
                    type="button"
                  >
                    {copied === profile.mention ? "Copied" : "Copy"}
                  </button>
                </div>
                {profile.fullMention ? <small>{profile.fullMention} works too.</small> : null}
              </div>
              <dl>
                <div>
                  <dt>Born</dt>
                  <dd>{formatCalendarDate(profile.birthDate)}</dd>
                </div>
                <div>
                  <dt>Birthplace</dt>
                  <dd>{profile.birthplace ?? "Not added"}</dd>
                </div>
              </dl>
              <div className="people-card-actions">
                <button
                  onClick={() => {
                    setDraft({
                      profileId: profile.id,
                      fullBirthName: profile.name,
                      birthDate: profile.birthDate,
                      birthplace: profile.birthplace ?? "",
                      birthTime: profile.birthTime ?? "",
                      permissionConfirmed: false,
                    });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  type="button"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    setDeleteError(undefined);
                    setPendingDelete(profile);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>

      <ConfirmDialog
        busy={deleting}
        busyLabel="Deleting…"
        confirmLabel="Delete profile"
        error={deleteError}
        onCancel={() => {
          setPendingDelete(undefined);
          setDeleteError(undefined);
        }}
        onConfirm={() => void confirmDelete()}
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete ${pendingDelete.name}’s profile?` : "Delete profile?"}
      >
        {pendingDelete ? (
          <>
            <p>
              Their birth details will be permanently removed, and {pendingDelete.mention} will no
              longer work in new questions.
            </p>
            <p>
              Past readings that mentioned them stay exactly as they were — their cards and
              interpretation don’t change.
            </p>
          </>
        ) : null}
      </ConfirmDialog>
    </main>
  );
}
