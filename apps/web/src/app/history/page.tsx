"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, LoadingState, Panel } from "@starguidance/design-system";

interface HistoryItem {
  id: string;
  spreadId: string;
  spreadName: string;
  questionPreview: string;
  generationStatus: string;
  followUpCount: number;
  feedbackSubmitted: boolean;
  reportStatus: "not-purchased" | "pending" | "ready" | "failed";
  createdAt: string;
}
export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>();
  const [error, setError] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const router = useRouter();
  useEffect(() => {
    void fetch("/api/readings", { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) return router.push("/sign-in");
      if (!response.ok) return setError("Unable to load reading history.");
      const payload = (await response.json()) as { readings: HistoryItem[] };
      setItems(payload.readings);
    });
  }, [router]);
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12">
      <h1 className="text-5xl font-semibold">Reading history</h1>
      {error && (
        <p className="mt-6" role="alert">
          {error}
        </p>
      )}
      <div className="mt-8 grid gap-4">
        {!items ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState title="No readings yet">Your locked readings will appear here.</EmptyState>
        ) : (
          items.map((item) => (
            <Panel key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <Link
                  className="min-w-0 flex-1"
                  href={
                    item.generationStatus === "ready"
                      ? `/reading/${item.id}`
                      : `/session/${item.id}`
                  }
                >
                  <p className="text-sm text-[#d8b56d]">{item.spreadName}</p>
                  <h2 className="mt-2 text-xl">{item.questionPreview}</h2>
                  <p className="mt-2 text-sm text-[#a99db5]">
                    {new Date(item.createdAt).toLocaleString()} · {item.generationStatus}
                  </p>
                  <p className="mt-2 text-xs text-[#b8afc2]">
                    {item.followUpCount > 0
                      ? `${item.followUpCount} follow-up${item.followUpCount === 1 ? "" : "s"}`
                      : "No follow-up"}
                    {item.feedbackSubmitted ? " · feedback shared" : " · feedback open"}
                    {` · report ${item.reportStatus}`}
                  </p>
                </Link>
                <Button
                  disabled={deletingId === item.id}
                  onClick={async () => {
                    if (!window.confirm("Permanently delete this reading and its follow-up?"))
                      return;
                    setDeletingId(item.id);
                    setError(undefined);
                    try {
                      const response = await fetch(`/api/readings/${item.id}`, {
                        method: "DELETE",
                      });
                      if (!response.ok) {
                        const payload = (await response.json()) as { error?: string };
                        setError(payload.error ?? "The reading could not be deleted.");
                        return;
                      }
                      setItems((current) => current?.filter(({ id }) => id !== item.id));
                    } finally {
                      setDeletingId(undefined);
                    }
                  }}
                >
                  {deletingId === item.id ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </Panel>
          ))
        )}
      </div>
    </main>
  );
}
