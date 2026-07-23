"use client";
import { useRouter } from "next/navigation";
import { Button, Panel } from "@starguidance/design-system";
export default function PrivacyPage() {
  const router = useRouter();
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <h1 className="text-5xl font-semibold">Privacy controls</h1>
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
      <Panel className="mt-5 border-[#6f3341]">
        <h2 className="text-2xl">Delete account</h2>
        <p className="mt-2 text-[#b8adc8]">
          The local adapter removes the account, profile, readings, reports, and session
          immediately.
        </p>
        <Button
          className="mt-4"
          onClick={async () => {
            if (!window.confirm("Delete this local account and all its data?")) return;
            await fetch("/api/account", { method: "DELETE" });
            router.push("/");
            router.refresh();
          }}
        >
          Delete my account
        </Button>
      </Panel>
    </main>
  );
}
