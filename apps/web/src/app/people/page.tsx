"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface PersonProfile {
  id: string;
  snapshotId: string;
  version: number;
  name: string;
  mention: string;
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

const emptyDraft: PersonDraft = {
  fullBirthName: "",
  birthDate: "",
  birthplace: "",
  birthTime: "",
  permissionConfirmed: false,
};

export default function PeoplePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<PersonProfile[]>();
  const [limit, setLimit] = useState(20);
  const [draft, setDraft] = useState<PersonDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const requestProfiles = useCallback(async () => {
    const response = await fetch("/api/people", { cache: "no-store" });
    if (response.status === 401) {
      router.push("/sign-in?next=/people");
      return undefined;
    }
    const body = (await response.json()) as {
      profiles?: PersonProfile[];
      limit?: number;
      error?: string;
    };
    return response.ok
      ? { profiles: body.profiles ?? [], limit: body.limit ?? 20 }
      : { error: body.error ?? "People profiles could not be loaded." };
  }, [router]);

  useEffect(() => {
    let active = true;
    void requestProfiles().then((result) => {
      if (!active || !result) return;
      if ("error" in result) setError(result.error);
      else {
        setProfiles(result.profiles);
        setLimit(result.limit);
      }
    });
    return () => {
      active = false;
    };
  }, [requestProfiles]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(draft.profileId ? { profileId: draft.profileId } : {}),
          fullBirthName: draft.fullBirthName,
          birthDate: draft.birthDate,
          ...(draft.birthplace.trim() ? { birthplace: draft.birthplace.trim() } : {}),
          ...(draft.birthTime ? { birthTime: draft.birthTime } : {}),
          permissionConfirmed: draft.permissionConfirmed,
        }),
      });
      if (response.status === 401) return router.push("/sign-in?next=/people");
      if (response.status === 428) return router.push("/consent?next=/people");
      const body = (await response.json()) as { profile?: PersonProfile; error?: string };
      if (!response.ok) return setError(body.error ?? "The person profile could not be saved.");
      setNotice(
        draft.profileId
          ? `${body.profile?.name ?? "The profile"} was updated for future readings.`
          : `${body.profile?.mention ?? "The mention"} is ready to use in a question.`,
      );
      setDraft(emptyDraft);
      const refreshed = await requestProfiles();
      if (refreshed && "error" in refreshed) setError(refreshed.error);
      else if (refreshed) {
        setProfiles(refreshed.profiles);
        setLimit(refreshed.limit);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="people-vault-page">
      <header className="people-vault-hero">
        <p>Private relationship context</p>
        <h1>People in your life</h1>
        <span>
          Save someone only with their permission. Mention them in a reading with the private handle
          shown below; their traits can deepen interpretation but can never influence which cards
          you pick.
        </span>
      </header>

      <div className="people-vault-layout">
        <section className="people-profile-editor" aria-label="Person profile editor">
          <div>
            <p>{draft.profileId ? "Update profile" : "New profile"}</p>
            <h2>{draft.profileId ? "Save a new snapshot" : "Add someone you know"}</h2>
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
                {saving ? "Calculating privately…" : draft.profileId ? "Save update" : "Add person"}
              </button>
            </div>
          </form>
          {error ? <p role="alert">{error}</p> : null}
          {notice ? <p aria-live="polite">{notice}</p> : null}
        </section>

        <section className="people-profile-list" aria-label="Saved people">
          <header>
            <div>
              <p>Private directory</p>
              <h2>Saved people</h2>
            </div>
            <span>
              {profiles?.length ?? 0} / {limit}
            </span>
          </header>
          {profiles === undefined ? <p>Opening the private directory…</p> : null}
          {profiles?.length === 0 ? (
            <div className="people-empty-state">
              <span aria-hidden="true">✦</span>
              <p>No one has been added yet.</p>
            </div>
          ) : null}
          {profiles?.map((profile) => (
            <article key={profile.id}>
              <div>
                <p>{profile.name}</p>
                <code>{profile.mention}</code>
              </div>
              <dl>
                <div>
                  <dt>Born</dt>
                  <dd>{profile.birthDate}</dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>{profile.birthplace ?? "Date only"}</dd>
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
                  onClick={async () => {
                    if (!window.confirm(`Delete ${profile.name}'s private profile?`)) return;
                    setError(undefined);
                    const response = await fetch("/api/people", {
                      method: "DELETE",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ profileId: profile.id }),
                    });
                    const body = (await response.json()) as { error?: string };
                    if (!response.ok)
                      return setError(body.error ?? "The person profile could not be deleted.");
                    if (draft.profileId === profile.id) setDraft(emptyDraft);
                    setNotice(`${profile.name}'s saved profile was deleted.`);
                    const refreshed = await requestProfiles();
                    if (refreshed && "error" in refreshed) setError(refreshed.error);
                    else if (refreshed) {
                      setProfiles(refreshed.profiles);
                      setLimit(refreshed.limit);
                    }
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
    </main>
  );
}
