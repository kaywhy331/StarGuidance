"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, LoadingState, Panel } from "@starguidance/design-system";
import { buildReportDocumentModel } from "@/lib/report-document";
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

const REPORT_CHAPTERS = [
  {
    number: "I",
    id: "foundation",
    title: "Foundation",
    description: "The stable center of the current profile snapshot.",
    keys: ["overview", "core-motivations", "strengths", "growth-opportunities"],
  },
  {
    number: "II",
    id: "inner-life",
    title: "Inner life",
    description: "Emotion, relationship, communication, and recurring tension.",
    keys: ["emotional-patterns", "relationships", "communication-decisions", "internal-tensions"],
  },
  {
    number: "III",
    id: "source-systems",
    title: "Source systems",
    description: "Each calculation kept distinct, versioned, and honest about availability.",
    keys: ["astrology", "numerology", "bazi", "dreamspell", "nine-star-ki", "planetary-angularity"],
  },
  {
    number: "IV",
    id: "integration",
    title: "Integration",
    description: "Agreements, contradictions, and practical prompts held together.",
    keys: ["cross-system-convergence", "cross-system-contradictions", "practical-integration"],
  },
] as const;

export function ReportView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();
  const router = useRouter();
  const loadReport = useCallback(async () => {
    const response = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
    if (response.status === 401) return router.push("/sign-in");
    if (!response.ok) return setError("This report is unavailable.");
    const payload = (await response.json()) as { report: Report };
    setReport(payload.report);
    setError(undefined);
  }, [reportId, router]);
  useEffect(() => {
    const timer = setTimeout(() => void loadReport(), 0);
    return () => clearTimeout(timer);
  }, [loadReport]);
  useEffect(() => {
    if (report?.status !== "pending") return;
    const timer = setInterval(() => void loadReport(), 2_000);
    return () => clearInterval(timer);
  }, [loadReport, report?.status]);
  useEffect(() => {
    if (report?.status !== "ready") return;
    emitBrowserProductEventOnce("report_viewed", `report:${reportId}`, {
      routeClass: "report",
      statusClass: "ready",
    });
  }, [report?.status, reportId]);
  if (error)
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Panel>
          <h1 className="text-3xl">Report unavailable</h1>
          <p className="mt-3">{error}</p>
        </Panel>
      </main>
    );
  if (!report)
    return (
      <main className="grid min-h-screen place-items-center">
        <LoadingState label="Preparing your report…" />
      </main>
    );
  if (report.status === "pending")
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Panel>
          <p className="text-sm tracking-[.2em] text-[#d8b56d] uppercase">Payment confirmed</p>
          <h1 className="mt-3 text-3xl">Your report is being prepared</h1>
          <p className="mt-3 text-[#b8adc8]">
            The purchase is retained while a background job builds the deterministic report. This
            page checks automatically; leaving it will not cancel fulfillment.
          </p>
          <div className="mt-6">
            <LoadingState label="Preparing your report…" />
          </div>
        </Panel>
      </main>
    );
  if (report.status === "failed")
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Panel>
          <h1 className="text-3xl">Report preparation paused</h1>
          <p className="mt-3 text-[#b8adc8]">
            Your purchase and locked report source are retained. Retry preparation without another
            charge.
          </p>
          <Button
            className="mt-5"
            onClick={async () => {
              const response = await fetch(`/api/reports/${reportId}`, { method: "POST" });
              const payload = (await response.json()) as {
                reportStatus?: Report["status"];
                error?: string;
              };
              if (!response.ok) return setError(payload.error ?? "Retry could not be scheduled.");
              setReport((current) =>
                current ? { ...current, status: payload.reportStatus ?? "pending" } : current,
              );
            }}
          >
            Retry report preparation
          </Button>
        </Panel>
      </main>
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
        <Link href="/profile">← Profile vault</Link>
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
          Source-backed sections only. Unavailable systems remain visible as explicit boundaries.
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
              A map of stable signals, productive tensions, and systems that remain deliberately
              unresolved.
            </blockquote>
            <dl>
              <div>
                <dt>Edition</dt>
                <dd>{new Date(report.createdAt).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt>Source status</dt>
                <dd>
                  {availableCount} of {document.sections.length} available
                </dd>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd>Immutable</dd>
              </div>
            </dl>
          </div>
          <div
            aria-label={`${availableCount} available and ${document.sections.length - availableCount} unavailable report sections`}
            className="pattern-atlas-constellation"
            role="img"
          >
            <PrivateSigil label="Profile pattern constellation" seed={sigilSeed} />
            {document.sections.map((section, index) => {
              const angle = (Math.PI * 2 * index) / document.sections.length - Math.PI / 2;
              const radius = index % 2 === 0 ? 31 : 42;
              return (
                <a
                  aria-label={`${section.title}, ${section.unavailable ? "unavailable" : "available"}`}
                  data-unavailable={Boolean(section.unavailable)}
                  href={`#atlas-section-${section.key}`}
                  key={section.key}
                  style={
                    {
                      "--atlas-node-x": `${50 + Math.cos(angle) * radius}%`,
                      "--atlas-node-y": `${50 + Math.sin(angle) * radius}%`,
                    } as CSSProperties
                  }
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
              <span>{chapter.number}</span>
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
                  <section
                    className="pattern-atlas-section"
                    data-unavailable={Boolean(section.unavailable)}
                    id={`atlas-section-${section.key}`}
                    key={section.key}
                  >
                    <header>
                      <span>{String(ordinal).padStart(2, "0")}</span>
                      <div>
                        <h3>{section.title}</h3>
                        <p>{section.statusLabel ?? "Source-backed pattern"}</p>
                      </div>
                    </header>
                    <p>{section.body}</p>
                  </section>
                );
              })}
            </div>
          </section>
        ))}

        <footer className="pattern-atlas-colophon">
          <PrivateSigil label="End mark" seed={sigilSeed} subtle />
          <p>
            This edition remains bound to its original profile snapshot. Later birth-data edits
            create a new edition and never rewrite this one.
          </p>
        </footer>
      </article>
    </main>
  );
}
