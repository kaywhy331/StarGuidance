"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, LoadingState } from "@starguidance/design-system";

interface HistoryItem {
  id: string;
  spreadId: string;
  spreadName: string;
  questionPreview: string;
  resultTitle?: string;
  generationStatus: string;
  cardCount: number;
  cards: Array<{
    cardId: string;
    orientation: "upright" | "reversed";
    artPath: string;
  }>;
  followUpCount: number;
  feedbackSubmitted: boolean;
  outcomeFeedbackSubmitted: boolean;
  reportStatus: "not-purchased" | "pending" | "ready" | "failed";
  createdAt: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function ReadingMemory({
  deleting,
  item,
  onDelete,
}: {
  deleting: boolean;
  item: HistoryItem;
  onDelete: () => Promise<void>;
}) {
  const createdAt = new Date(item.createdAt);
  const href = item.generationStatus === "ready" ? `/reading/${item.id}` : `/session/${item.id}`;
  const threadStatus = [
    item.followUpCount > 0
      ? `${item.followUpCount} saved follow-up${item.followUpCount === 1 ? "" : "s"}`
      : undefined,
    item.outcomeFeedbackSubmitted ? "Outcome reflection saved" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="reading-memory">
      <span aria-hidden="true" className="reading-memory-node" />
      <div className="reading-memory-panel">
        <Link
          aria-label={`Open reading: ${item.questionPreview}`}
          className="reading-memory-link"
          href={href}
        >
          <header>
            <div>
              <time dateTime={item.createdAt}>{dateFormatter.format(createdAt)}</time>
              <span aria-hidden="true">·</span>
              <span>{timeFormatter.format(createdAt)}</span>
            </div>
            <span className={`reading-memory-status is-${item.generationStatus}`}>
              {item.generationStatus === "ready" ? "Reading held" : item.generationStatus}
            </span>
          </header>

          <div aria-hidden="true" className="reading-memory-card-fan">
            {item.cards.slice(0, 5).map((card, index) => (
              <span
                data-orientation={card.orientation}
                key={`${card.cardId}-${index}`}
                style={
                  {
                    "--memory-card-index": index,
                    "--memory-card-total": Math.min(item.cards.length, 5),
                  } as CSSProperties
                }
              >
                <Image alt="" height={142} src={card.artPath} unoptimized width={88} />
              </span>
            ))}
          </div>

          <div className="reading-memory-copy">
            <p>{item.spreadName}</p>
            <h2>{item.resultTitle ?? item.questionPreview}</h2>
            {item.resultTitle && <blockquote>“{item.questionPreview}”</blockquote>}
          </div>

          <footer>
            <span>{item.cardCount} locked cards</span>
            <span>{threadStatus || "Original thread"}</span>
            <strong>
              {item.generationStatus === "ready" ? "Enter the reading →" : "Resume →"}
            </strong>
          </footer>
        </Link>
        <Button
          aria-label={`Delete reading from ${dateFormatter.format(createdAt)}`}
          className="reading-memory-delete"
          disabled={deleting}
          onClick={() => void onDelete()}
          variant="danger"
        >
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </article>
  );
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>();
  const [error, setError] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const router = useRouter();

  useEffect(() => {
    void fetch("/api/readings", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return router.push("/sign-in");
        if (!response.ok) return setError("Unable to load reading history.");
        const payload = (await response.json()) as { readings: HistoryItem[] };
        setItems(payload.readings);
      })
      .catch(() => setError("Unable to load reading history."));
  }, [router]);

  const totals = useMemo(
    () => ({
      cards: items?.reduce((sum, item) => sum + item.cardCount, 0) ?? 0,
      followUps: items?.reduce((sum, item) => sum + item.followUpCount, 0) ?? 0,
    }),
    [items],
  );

  return (
    <main className="history-constellation-shell">
      <header className="history-constellation-header">
        <div>
          <p className="page-eyebrow">Private archive · immutable draws</p>
          <h1>Your constellation of readings</h1>
          <p>
            Each light holds the question, profile snapshot, and exact cards from one moment. Reopen
            a thread whenever you need it; its draw will never change.
          </p>
        </div>
        <Link className="history-new-reading" href="/readings">
          <span>Open a new threshold</span>
          <strong>
            Begin a reading <b aria-hidden="true">→</b>
          </strong>
        </Link>
      </header>

      {items && items.length > 0 && (
        <aside aria-label="Reading archive summary" className="history-constellation-summary">
          <span>
            <strong>{items.length}</strong> reading{items.length === 1 ? "" : "s"}
          </span>
          <i aria-hidden="true" />
          <span>
            <strong>{totals.cards}</strong> cards held
          </span>
          <i aria-hidden="true" />
          <span>
            <strong>{totals.followUps}</strong> continued thread{totals.followUps === 1 ? "" : "s"}
          </span>
        </aside>
      )}

      {error && (
        <p className="history-constellation-error" role="alert">
          {error}
        </p>
      )}

      <section aria-label="Saved readings" className="reading-memory-timeline">
        {!items ? (
          <LoadingState label="Finding your saved lights…" />
        ) : items.length === 0 ? (
          <EmptyState title="Your constellation is waiting">
            <p>A finished reading will become the first light in this private archive.</p>
            <Link className="history-empty-action" href="/readings">
              Begin your first reading
            </Link>
          </EmptyState>
        ) : (
          items.map((item) => (
            <ReadingMemory
              deleting={deletingId === item.id}
              item={item}
              key={item.id}
              onDelete={async () => {
                if (!window.confirm("Permanently delete this reading and its follow-up?")) return;
                setDeletingId(item.id);
                setError(undefined);
                try {
                  const response = await fetch(`/api/readings/${item.id}`, { method: "DELETE" });
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
            />
          ))
        )}
      </section>
    </main>
  );
}
