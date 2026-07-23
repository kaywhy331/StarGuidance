"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, LoadingState, Panel } from "@starguidance/design-system";

interface ProfileView {
  snapshot: { id: string; version: number; completeness: string };
  maskedName: string;
  birthDate: string;
  timeKind: string;
  birthplaceLabel?: string;
}
export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileView | null>();
  const [message, setMessage] = useState<string>();
  const router = useRouter();
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
              <dt className="text-sm text-[#a99db5]">Time status</dt>
              <dd>{profile.timeKind}</dd>
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
        {profile && (
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
            Purchase test report
          </Button>
        )}
      </div>
      {message && (
        <p className="mt-4" role="alert">
          {message}
        </p>
      )}
    </main>
  );
}
