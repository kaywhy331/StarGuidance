"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, LoadingState, Panel } from "@starguidance/design-system";

interface ProfileView {
  snapshot: { id: string; version: number; completeness: string };
  maskedName: string;
  birthDate: string;
  birthTimeProvided: boolean;
  birthplaceLabel?: string;
}
export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileView | null>();
  const [message, setMessage] = useState<string>();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const profileReportsEnabled = process.env.NEXT_PUBLIC_ENABLE_PROFILE_REPORTS === "true";
  useEffect(() => {
    void fetch("/api/profile", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) return router.push("/sign-in");
      const payload = (await response.json()) as { profile: ProfileView | null };
      setProfile(payload.profile);
    });
  }, [router]);
  if (profile === undefined)
    return (
      <main className="grid min-h-screen place-items-center">
        <LoadingState />
      </main>
    );
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <h1 className="text-5xl font-semibold">Private profile</h1>
      {!profile ? (
        <Panel className="mt-8">
          <p>No profile exists yet.</p>
        </Panel>
      ) : (
        <Panel className="mt-8">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-[#a99db5]">Birth name</dt>
              <dd>{profile.maskedName}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#a99db5]">Birth date</dt>
              <dd>{profile.birthDate}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#a99db5]">Birth time</dt>
              <dd>{profile.birthTimeProvided ? "Provided" : "Not provided"}</dd>
            </div>
            <div>
              <dt className="text-sm text-[#a99db5]">Capability</dt>
              <dd>{profile.snapshot.completeness}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-[#a99db5]">
            Snapshot v{profile.snapshot.version}. Changes create a new snapshot and never
            reinterpret past readings.
          </p>
        </Panel>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={() => router.push("/onboarding")}>Update birth facts</Button>
        {profile && profileReportsEnabled && (
          <Button
            onClick={async () => {
              const response = await fetch("/api/reports/checkout", {
                method: "POST",
                headers: { "idempotency-key": profile.snapshot.id },
              });
              const payload = (await response.json()) as {
                reportId?: string;
                checkoutUrl?: string;
                error?: string;
              };
              if (payload.reportId) router.push(`/report/${payload.reportId}`);
              else if (payload.checkoutUrl) window.location.assign(payload.checkoutUrl);
              else setMessage(payload.error);
            }}
          >
            Generate test profile report
          </Button>
        )}
      </div>
      {message && (
        <p className="mt-4" role="alert">
          {message}
        </p>
      )}
      {profile ? (
        <Panel className="mt-8 border-[#6f3341]">
          <h2 className="text-2xl">Delete private profile</h2>
          <p className="mt-2 text-[#b8adc8]">
            This removes every profile snapshot and all dependent readings, report records, and
            entitlements. Your login and policy receipts remain so you can start over.
          </p>
          <div className="mt-4 max-w-sm">
            <Field
              autoComplete="off"
              label='Type "DELETE PROFILE"'
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              value={deleteConfirmation}
            />
          </div>
          <Button
            className="mt-4"
            disabled={deleting || deleteConfirmation !== "DELETE PROFILE"}
            onClick={async () => {
              setDeleting(true);
              setMessage(undefined);
              try {
                const response = await fetch("/api/profile", {
                  method: "DELETE",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ confirmation: deleteConfirmation }),
                });
                const payload = (await response.json()) as { error?: string };
                if (!response.ok) {
                  setMessage(payload.error ?? "The private profile could not be deleted.");
                  return;
                }
                setProfile(null);
                setDeleteConfirmation("");
                setMessage("Your private profile and its dependent records were deleted.");
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Deleting profile…" : "Delete private profile"}
          </Button>
        </Panel>
      ) : null}
    </main>
  );
}
