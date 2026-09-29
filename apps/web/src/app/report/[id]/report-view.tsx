"use client";

import { MotionReveal } from "../../site-motion";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, LoadingState } from "@starguidance/design-system";
import { signInPathFor } from "@/lib/account-return";
import { requestJson } from "@/lib/client-request";
import { buildReportDocumentModel, formatReportEditionDate } from "@/lib/report-document";
import { emitBrowserProductEventOnce } from "@/lib/product-telemetry-client";
import { PrivateSigil } from "../../session/[id]/private-sigil";

interface Report {
  id: string;
  snapshotId: string | null;
  provider: "local" | "stripe";
  status: "pending" | "ready" | "failed";
  sections: { key: string; title: string; body: string; unavailable?: boolean }[];
  createdAt: string;
}

/** Poll every 2 s for up to 3 minutes before asking the reader to check back. */
const POLL_INTERVAL_MS = 2_000;
const POLL_CEILING = 90;

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

const REPORT_CHAPTERS = [
  {
    number: "I",
    id: "foundation",
    title: "Foundation",
    description: "The steadiest themes in your profile, and where they invite growth.",
    keys: ["overview", "core-motivations", "strengths", "growth-opportunities"],
  },
  {
    number: "II",
    id: "inner-life",
    title: "Inner life",
    description: "Feelings, relationships, how you communicate, and the tensions you carry.",
    keys: ["emotional-patterns", "relationships", "communication-decisions", "internal-tensions"],
  },
  {
    number: "III",
    id: "source-systems",
    title: "The traditions",
    description: "What each tradition sees on its own terms — and what isn’t included yet.",
    keys: ["astrology", "numerology", "bazi", "dreamspell", "nine-star-ki", "planetary-angularity"],
  },
  {
    number: "IV",
    id: "integration",
    title: "Bringing it together",
    description: "Where the traditions agree, where they differ, and how to put it to use.",
    keys: ["cross-system-convergence", "cross-system-contradictions", "practical-integration"],
  },
] as const;

type ViewState =
  | { phase: "loading" }
  | { phase: "error"; title: string; message: string; retryable: boolean }
  | { phase: "report"; report: Report };

function SupportLine({ reportId }: { reportId: string }) {
  const reference = reportId.slice(0, 8);
  return SUPPORT_EMAIL ? (
    <p className="atlas-state__support">
      Still stuck?{" "}
      <a
        href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Pattern atlas ${reference}`)}`}
      >
        Contact support
      </a>{" "}
      and mention reference <code>{reference}</code>.
    </p>
  ) : (
    <p className="atlas-state__support">
      Still stuck? Contact support and mention reference <code>{reference}</code> — you won’t be
      charged again.
    </p>
  );
}

function AtlasStatePanel({
  eyebrow,
  title,
  children,
  role,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  role?: "alert" | "status" | undefined;
}) {
  return (
    <main className="atlas-state-shell">
      <Link className="atlas-state__back" href="/reports">
        ← Your reports
      </Link>
      <section className="atlas-state" role={role}>
        <span aria-hidden="true" className="atlas-state__mark">
          ✦
        </span>
        <p className="atlas-state__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function ReportView({ reportId }: { reportId: string }) {
  const [view, setView] = useState<ViewState>({ phase: "loading" });
  const [pollExhausted, setPollExhausted] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const pollCount = useRef(0);
  const router = useRouter();
  const report = view.phase === "report" ? view.report : undefined;

  const loadReport = useCallback(
    async (background = false) => {
      const result = await requestJson<{ report: Report }>(`/api/reports/${reportId}`, {
        cache: "no-store",
      });
      if (!result.ok) {
        if (result.status === 401) {
          router.push(signInPathFor(`/report/${reportId}`));
          return;
        }
        // A transient failure while polling keeps the current view.
        if (background && result.status !== 404) return;
        setView({
          phase: "error",
          title:
            result.status === 404 ? "We couldn’t find this atlas" : "Your atlas couldn’t be opened",
          message: result.error,
          retryable: result.status !== 404,
        });
        return;
      }
      setView({ phase: "report", report: result.data.report });
    },
    [reportId, router],
  );

  useEffect(() => {
    const timer = setTimeout(() => void loadReport(), 0);
    return () => clearTimeout(timer);
  }, [loadReport]);

  useEffect(() => {
    if (report?.status !== "pending" || pollExhausted) return;
    const timer = setInterval(() => {
      pollCount.current += 1;
      if (pollCount.current >= POLL_CEILING) {
        setPollExhausted(true);
        return;
      }
      void loadReport(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadReport, pollExhausted, report?.status]);

  useEffect(() => {
    if (report?.status !== "ready") return;
    emitBrowserProductEventOnce("report_viewed", `report:${reportId}`, {
      routeClass: "report",
      statusClass: "ready",
    });
  }, [report?.status, reportId]);

  const retryPreparation = useCallback(async () => {
    setRetrying(true);
    setRetryError(undefined);
    try {
      const result = await requestJson<{ reportStatus?: Report["status"] }>(
        `/api/reports/${reportId}`,
        { method: "POST" },
      );
      if (!result.ok) {
        if (result.status === 401) {
          router.push(signInPathFor(`/report/${reportId}`));
          return;
        }
        setRetryError(result.error);
        return;
      }
      pollCount.current = 0;
      setPollExhausted(false);
      setView((current) =>
        current.phase === "report"
          ? {
              phase: "report",
              report: { ...current.report, status: result.data.reportStatus ?? "pending" },
            }
          : current,
      );
    } finally {
      setRetrying(false);
    }
  }, [reportId, router]);

  if (view.phase === "error")
    return (
      <AtlasStatePanel eyebrow="Pattern atlas" role="alert" title={view.title}>
        <p>{view.message}</p>
        <div className="atlas-state__actions">
          {view.retryable ? (
            <Button
              onClick={() => {
                setView({ phase: "loading" });
                void loadReport();
              }}
            >
              Try again
            </Button>
          ) : null}
          <Link href="/reports">Go to your reports</Link>
        </div>
        <SupportLine reportId={reportId} />
      </AtlasStatePanel>
    );

  if (!report)
    return (
      <main className="atlas-state-shell">
        <LoadingState label="Opening your atlas…" />
      </main>
    );

  if (report.status === "pending")
    return (
      <AtlasStatePanel
        eyebrow="Payment confirmed"
        role={pollExhausted ? "status" : undefined}
        title={
          pollExhausted ? "This is taking longer than usual" : "Your atlas is being inscribed…"
        }
      >
        {pollExhausted ? (
          <>
            <p>
              Your payment is safe and your atlas is still being prepared. You can leave this page —
              it will be waiting in Reports when it’s ready.
            </p>
            <div className="atlas-state__actions">
              <Button
                onClick={() => {
                  pollCount.current = 0;
                  setPollExhausted(false);
                  void loadReport(true);
                }}
              >
                Check again
              </Button>
              <Link href="/reports">Go to your reports</Link>
            </div>
          </>
        ) : (
          <>
            <p>
              We’re writing each section from your birth details. This usually takes under a minute.
              You can leave this page — preparation carries on without you.
            </p>
            <div className="atlas-state__loading">
              <LoadingState label="Inscribing your atlas…" />
            </div>
          </>
        )}
      </AtlasStatePanel>
    );

  if (report.status === "failed")
    return (
      <AtlasStatePanel eyebrow="Pattern atlas" title="Preparation paused">
        <p>
          Something interrupted your atlas partway through. Your purchase is safe, and trying again
          won’t charge you a second time.
        </p>
        <div className="atlas-state__actions">
          <Button disabled={retrying} onClick={() => void retryPreparation()}>
            {retrying ? "Restarting…" : "Try preparing it again"}
          </Button>
          <Link href="/reports">Go to your reports</Link>
        </div>
        {retryError ? (
          <p className="atlas-state__error" role="alert">
            {retryError}
          </p>
        ) : null}
        <SupportLine reportId={reportId} />
      </AtlasStatePanel>
    );

  const document = buildReportDocumentModel(report);
  const knownKeys = new Set<string>(REPORT_CHAPTERS.flatMap(({ keys }) => keys));
  const chapters = REPORT_CHAPTERS.map((chapter) => ({
    ...chapter,
    sections: document.sections.filter(
      (section) =>
        (chapter.keys as readonly string[]).includes(section.key) ||
        (chapter.id === "integration" && !knownKeys.has(section.key)),
    ),
  })).filter(({ sections }) => sections.length > 0);
  const availableCount = document.sections.filter(({ unavailable }) => !unavailable).length;
  const sigilSeed = report.snapshotId ?? reportId;

  return (
    <main className="pattern-atlas-shell">
      <aside className="pattern-atlas-index">
        <Link href="/reports">← Your reports</Link>
        <div className="pattern-atlas-index__mark">
          <PrivateSigil seed={sigilSeed} />
          <p>
            <span>Private edition</span>
            <strong>Pattern atlas</strong>
          </p>
        </div>
        <nav aria-label="Pattern atlas contents">
          {chapters.map((chapter) => (
            <section key={chapter.id}>
              <a href={`#atlas-chapter-${chapter.id}`}>
                <span>{chapter.number}</span>
                {chapter.title}
              </a>
              {chapter.sections.map((section) => (
                <a href={`#atlas-section-${section.key}`} key={section.key}>
                  {section.title}
                </a>
              ))}
            </section>
          ))}
        </nav>
        <p className="pattern-atlas-index__note">
          Sections marked “Not in this edition” need details you haven’t added yet, or are still
          being prepared.
        </p>
      </aside>

      <article className="pattern-atlas-volume">
        <header className="pattern-atlas-cover">
          <div className="pattern-atlas-cover__copy">
            <p>{document.eyebrow}</p>
            <h1>
              Your private
              <br />
              pattern atlas
            </h1>
            <blockquote>
              A map of your steadiest themes, the tensions that keep you growing, and the parts of
              the picture still to come.
            </blockquote>
            <dl>
              <div>
                <dt>Edition</dt>
                <dd>{formatReportEditionDate(report.createdAt)}</dd>
              </div>
              <div>
                <dt>Included</dt>
                <dd>
                  {availableCount} of {document.sections.length} sections
                </dd>
              </div>
              <div>
                <dt>Yours to keep</dt>
                <dd>Never rewritten</dd>
              </div>
            </dl>
          </div>
          {/* Decorative echo of the contents list; the nav above is the accessible route. */}
          <div aria-hidden="true" className="pattern-atlas-constellation">
            <PrivateSigil label="Profile pattern constellation" seed={sigilSeed} />
            {document.sections.map((section, index) => {
              const angle = (Math.PI * 2 * index) / document.sections.length - Math.PI / 2;
              const radius = index % 2 === 0 ? 31 : 42;
              return (
                <a
                  data-unavailable={Boolean(section.unavailable)}
                  href={`#atlas-section-${section.key}`}
                  key={section.key}
                  style={
                    {
                      "--atlas-node-x": `${50 + Math.cos(angle) * radius}%`,
                      "--atlas-node-y": `${50 + Math.sin(angle) * radius}%`,
                    } as CSSProperties
                  }
                  tabIndex={-1}
                  title={section.title}
                >
                  <span>{index + 1}</span>
                </a>
              );
            })}
          </div>
        </header>

        <div className="pattern-atlas-actions">
          <Button onClick={() => window.print()}>Print atlas</Button>
          <a download href={`/api/reports/${reportId}/pdf`}>
            Download accessible PDF
          </a>
        </div>

        {chapters.map((chapter, chapterIndex) => (
          <section
            aria-labelledby={`atlas-chapter-${chapter.id}`}
            className="pattern-atlas-chapter"
            key={chapter.id}
          >
            <header>
              <span aria-hidden="true">{chapter.number}</span>
              <div>
                <p>Chapter {chapterIndex + 1}</p>
                <h2 id={`atlas-chapter-${chapter.id}`}>{chapter.title}</h2>
                <blockquote>{chapter.description}</blockquote>
              </div>
            </header>
            <div>
              {chapter.sections.map((section) => {
                const ordinal = document.sections.findIndex(({ key }) => key === section.key) + 1;
                return (
                  <MotionReveal key={section.key}>
                    <section
                      className="pattern-atlas-section"
                      data-unavailable={Boolean(section.unavailable)}
                      id={`atlas-section-${section.key}`}
                      key={section.key}
                    >
                      <header>
                        <span aria-hidden="true">{String(ordinal).padStart(2, "0")}</span>
                        <div>
                          <h3>{section.title}</h3>
                          <p>{section.statusLabel ?? "From your birth details"}</p>
                        </div>
                      </header>
                      <p>{section.meaning}</p>
                      {section.technicalNote ? (
                        <details className="pattern-atlas-technical">
                          <summary>Technical notes</summary>
                          <p>{section.technicalNote}</p>
                        </details>
                      ) : null}
                    </section>
                  </MotionReveal>
                );
              })}
            </div>
          </section>
        ))}

        <footer className="pattern-atlas-colophon">
          <PrivateSigil label="End mark" seed={sigilSeed} subtle />
          <p>
            This edition stays exactly as it was written. If you later update your birth details, a
            new edition can be made — this one is never rewritten.
          </p>
        </footer>
      </article>
    </main>
  );
}
