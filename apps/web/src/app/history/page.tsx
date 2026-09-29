"use client";

import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, LoadingState } from "@starguidance/design-system";
import { tarotCards } from "@starguidance/tarot-content";

import { signInPathFor } from "@/lib/account-return";
import { requestJson } from "@/lib/client-request";
import { PrivateSigil } from "../session/[id]/private-sigil";
import { ConfirmDialog } from "./confirm-dialog";
import { truncateAtWord } from "./history-format";

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
  /** Optional list fields from the readings API: an unfinished ritual whose session window closed. */
  sessionExpired?: boolean;
  expiresAt?: string;
  /** How far the ritual got (drawLocked … complete), when tracked. */
  ritualPhase?: string;
}

const IN_PROGRESS_LABELS: Record<string, string> = {
  drawLocked: "Cards chosen",
  dealing: "Cards chosen",
  awaitingReveal: "Cards laid out",
  revealing: "Revealing cards",
  fullSpreadReady: "All cards revealed",
  interpretationStreaming: "Reading in progress",
};

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; items: HistoryItem[] };

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const cardNames = new Map(tarotCards.map(({ id, name }) => [id, name]));

function isExpiredUnfinished(item: HistoryItem, now: number): boolean {
  if (item.generationStatus === "ready") return false;
  if (item.sessionExpired === true) return true;
  if (item.expiresAt) {
    const expires = Date.parse(item.expiresAt);
    return Number.isFinite(expires) && expires <= now;
  }
  return false;
}

function readingState(item: HistoryItem, now: number) {
  if (item.generationStatus === "ready")
    return {
      tone: "ready",
      icon: "✦",
      label: "Reading complete",
      href: `/reading/${item.id}`,
      action: "Enter the reading →",
    };
  if (isExpiredUnfinished(item, now))
    return {
      tone: "kept",
      icon: "◐",
      label: "Unfinished · cards kept",
      href: `/reading/${item.id}`,
      action: "See your cards →",
    };
  if (item.generationStatus === "failed")
    return {
      tone: "attention",
      icon: "↻",
      label: "Needs another try",
      href: `/session/${item.id}`,
      action: "Continue the reading →",
    };
  return {
    tone: "progress",
    icon: "◌",
    label: (item.ritualPhase ? IN_PROGRESS_LABELS[item.ritualPhase] : undefined) ?? "In progress",
    href: `/session/${item.id}`,
    action: "Resume the reading →",
  };
}

function followUpLabel(count: number) {
  return `${count} follow-up${count === 1 ? "" : "s"}`;
}

function ReadingMemory({
  item,
  now,
  onRequestDelete,
}: {
  item: HistoryItem;
  now: number;
  onRequestDelete: () => void;
}) {
  const createdAt = new Date(item.createdAt);
  const state = readingState(item, now);
  const question = truncateAtWord(item.questionPreview, 90) || "A reading without a question";
  const answer = item.resultTitle ? truncateAtWord(item.resultTitle, 110) : undefined;
  const titleId = useId();
  const threadStatus = [
    item.followUpCount > 0 ? followUpLabel(item.followUpCount) : undefined,
    item.outcomeFeedbackSubmitted ? "Reflection saved" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article aria-labelledby={titleId} className="reading-memory">
      <span aria-hidden="true" className="reading-memory-node">
        <PrivateSigil seed={item.id} subtle />
      </span>
      <div className="reading-memory-panel reading-memory-panel--v2">
        <header className="reading-memory-meta">
          <div>
            <time dateTime={item.createdAt}>{dateFormatter.format(createdAt)}</time>
            <span aria-hidden="true">·</span>
            <span>{timeFormatter.format(createdAt)}</span>
          </div>
          <span className={`reading-memory-status is-${state.tone}`}>
            <span aria-hidden="true">{state.icon}</span> {state.label}
          </span>
        </header>

        <div className="reading-memory-body">
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
          {item.cards.length > 0 ? (
            <ul aria-label="Cards drawn" className="sr-only">
              {item.cards.map((card, index) => (
                <li key={`${card.cardId}-${index}`}>
                  {cardNames.get(card.cardId) ?? card.cardId.replaceAll("-", " ")}
                  {card.orientation === "reversed" ? ", reversed" : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="reading-memory-copy">
            <p>{item.spreadName}</p>
            <h2 id={titleId}>{question}</h2>
            {answer ? <blockquote>{answer}</blockquote> : null}
          </div>
        </div>

        <footer className="reading-memory-footer">
          <span className="reading-memory-footer__meta">
            {item.cardCount} card{item.cardCount === 1 ? "" : "s"}
            {threadStatus ? ` · ${threadStatus}` : ""}
          </span>
          <Link className="reading-memory-primary" href={state.href}>
            {state.action}
            <span className="sr-only"> {question}</span>
          </Link>
          <details className="reading-memory-more">
            <summary>
              <span aria-hidden="true">⋯</span>
              <span className="sr-only">More options for this reading</span>
            </summary>
            <div>
              <button onClick={onRequestDelete} type="button">
                Delete reading…
              </button>
            </div>
          </details>
        </footer>
      </div>
    </article>
  );
}

export default function HistoryPage() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [pendingDelete, setPendingDelete] = useState<HistoryItem>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [search, setSearch] = useState("");
  const [spread, setSpread] = useState("all");
  const [now, setNow] = useState(0);
  const router = useRouter();
  const items = state.phase === "ready" ? state.items : undefined;

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    const result = await requestJson<{ readings: HistoryItem[] }>("/api/readings", {
      cache: "no-store",
    });
    if (!result.ok) {
      if (result.status === 401) {
        router.push(signInPathFor("/history"));
        return;
      }
      setState({ phase: "error", message: result.error });
      return;
    }
    setNow(Date.now());
    setState({ phase: "ready", items: result.data.readings ?? [] });
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const totals = useMemo(
    () => ({
      cards: items?.reduce((sum, item) => sum + item.cardCount, 0) ?? 0,
      followUps: items?.reduce((sum, item) => sum + item.followUpCount, 0) ?? 0,
    }),
    [items],
  );

  const spreadOptions = useMemo(
    () =>
      [...new Map((items ?? []).map((item) => [item.spreadId, item.spreadName])).entries()].sort(
        (left, right) => left[1].localeCompare(right[1]),
      ),
    [items],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (items ?? []).filter(
      (item) =>
        (spread === "all" || item.spreadId === spread) &&
        (!needle ||
          [item.questionPreview, item.resultTitle ?? "", item.spreadName]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [items, search, spread]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const result = await requestJson(`/api/readings/${target.id}`, { method: "DELETE" });
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      setState((current) =>
        current.phase === "ready"
          ? { phase: "ready", items: current.items.filter(({ id }) => id !== target.id) }
          : current,
      );
      setPendingDelete(undefined);
      setNotice("The reading was deleted.");
    } finally {
      setDeleting(false);
    }
  };

  const filtersActive = search.trim() !== "" || spread !== "all";

  return (
    <main className="history-constellation-shell">
      <header className="history-constellation-header">
        <div>
          <p className="page-eyebrow">History</p>
          <h1>Your constellation of readings</h1>
          <p>
            Every reading you begin is kept here privately, with the exact cards you drew. Open one
            any time — its cards never change.
          </p>
        </div>
        <Link className="history-new-reading" href="/readings">
          <span>Ask something new</span>
          <strong>
            Begin a reading <b aria-hidden="true">→</b>
          </strong>
        </Link>
      </header>

      {items && items.length > 0 && (
        <aside aria-label="Reading history summary" className="history-constellation-summary">
          <span>
            <strong>{items.length}</strong> reading{items.length === 1 ? "" : "s"}
          </span>
          <i aria-hidden="true" />
          <span>
            <strong>{totals.cards}</strong> card{totals.cards === 1 ? "" : "s"} drawn
          </span>
          <i aria-hidden="true" />
          <span>
            <strong>{totals.followUps}</strong> follow-up{totals.followUps === 1 ? "" : "s"}
          </span>
        </aside>
      )}

      {items && items.length > 1 ? (
        <div className="history-filters" role="search">
          <label>
            <span>Search your readings</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="A word from your question…"
              type="search"
              value={search}
            />
          </label>
          <label>
            <span>Spread</span>
            <select onChange={(event) => setSpread(event.target.value)} value={spread}>
              <option value="all">All spreads</option>
              {spreadOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p aria-live="polite" className="history-filters__count">
            {filtersActive
              ? `${visible.length} of ${items.length} reading${items.length === 1 ? "" : "s"} shown`
              : ""}
          </p>
        </div>
      ) : null}

      {notice ? (
        <p className="history-constellation-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section aria-label="Saved readings" className="reading-memory-timeline">
        {state.phase === "loading" ? (
          <LoadingState label="Gathering your readings…" />
        ) : state.phase === "error" ? (
          <div className="account-state-panel" role="alert">
            <span aria-hidden="true" className="account-state-panel__mark">
              ✦
            </span>
            <h2>We couldn’t load your readings</h2>
            <p>{state.message}</p>
            <p>Your readings are safe — nothing was changed.</p>
            <div className="account-state-panel__actions">
              <Button onClick={() => void load()}>Try again</Button>
              <Link href="/readings">Begin a new reading</Link>
            </div>
          </div>
        ) : state.items.length === 0 ? (
          <EmptyState title="Your first reading will appear here">
            <p>
              Bring a question to the cards. Your reading, the cards you drew, and any follow-ups
              will be kept here privately for you to return to.
            </p>
            <Link className="history-empty-action" href="/readings">
              Begin your first reading →
            </Link>
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState title="No readings match">
            <p>Try a different word or spread.</p>
            <button
              className="history-empty-action"
              onClick={() => {
                setSearch("");
                setSpread("all");
              }}
              type="button"
            >
              Clear search
            </button>
          </EmptyState>
        ) : (
          visible.map((item) => (
            <ReadingMemory
              item={item}
              key={item.id}
              now={now}
              onRequestDelete={() => {
                setDeleteError(undefined);
                setNotice(undefined);
                setPendingDelete(item);
              }}
            />
          ))
        )}
      </section>

      <ConfirmDialog
        busy={deleting}
        busyLabel="Deleting…"
        confirmLabel="Delete reading"
        error={deleteError}
        onCancel={() => {
          setPendingDelete(undefined);
          setDeleteError(undefined);
        }}
        onConfirm={() => void confirmDelete()}
        open={Boolean(pendingDelete)}
        title="Delete this reading?"
      >
        {pendingDelete ? (
          <p>
            “{truncateAtWord(pendingDelete.questionPreview, 90)}” from{" "}
            {dateFormatter.format(new Date(pendingDelete.createdAt))}, its cards and interpretation
            {pendingDelete.followUpCount > 0
              ? `, and its ${followUpLabel(pendingDelete.followUpCount)}`
              : ""}{" "}
            will be permanently removed. This can’t be undone.
          </p>
        ) : null}
      </ConfirmDialog>
    </main>
  );
}
