"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState, LoadingState, Panel } from "@starguidance/design-system";

interface HistoryItem {
  id: string;
  spreadId: string;
  questionPreview: string;
  generationStatus: string;
  createdAt: string;
}
export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>();
  const [error, setError] = useState<string>();
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
            <Link href={`/session/${item.id}`} key={item.id}>
              <Panel>
                <p className="text-sm text-[#d8b56d]">{item.spreadId}</p>
                <h2 className="mt-2 text-xl">{item.questionPreview}</h2>
                <p className="mt-2 text-sm text-[#a99db5]">
                  {new Date(item.createdAt).toLocaleString()} · {item.generationStatus}
                </p>
              </Panel>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
