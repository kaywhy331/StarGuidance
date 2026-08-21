"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, LoadingState, Panel } from "@starguidance/design-system";

import type { OperationalRole } from "@/lib/operational-access";

import { OperatorConfigurationPanel } from "./operator-configuration-panel";

interface OperationsPayload {
  role: OperationalRole;
  diagnostics: Record<
    "interpretation" | "report",
    { statuses: Record<string, number>; failedByClass: Record<string, number> }
  >;
  productMeasurement: {
    windowHours: number;
    events: Record<string, number>;
  };
  trace: {
    id: string;
    entities: { type: string; status: string; createdAt: string }[];
  } | null;
  configuration: Record<string, string | number | boolean>;
}

export function OperationsConsole({ role }: { role: OperationalRole }) {
  const [payload, setPayload] = useState<OperationsPayload>();
  const [traceId, setTraceId] = useState("");
  const [message, setMessage] = useState<string>();

  const load = useCallback(async (id?: string) => {
    setMessage(undefined);
    const response = await fetch(
      `/api/operations${id ? `?traceId=${encodeURIComponent(id)}` : ""}`,
      { cache: "no-store" },
    );
    const body = (await response.json()) as OperationsPayload & { error?: string };
    if (!response.ok) return setMessage(body.error ?? "Operational diagnostics are unavailable.");
    setPayload(body);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const retry = async (queue: "interpretation" | "report") => {
    if (!payload?.trace) return;
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "retry-job", queue, targetId: payload.trace.id }),
    });
    const body = (await response.json()) as { error?: string };
    setMessage(response.ok ? "The failed job was safely requeued and audited." : body.error);
    if (response.ok) await load(payload.trace.id);
  };

  return (
    <div className="mt-8 grid gap-6">
      {!payload ? (
        <LoadingState label="Loading masked operational status…" />
      ) : (
        <>
          <Panel>
            <h2 className="text-2xl">Durable queues</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(["interpretation", "report"] as const).map((queue) => (
                <section key={queue}>
                  <h3 className="font-semibold capitalize">{queue}</h3>
                  <p className="mt-1 text-sm text-[#b8adc8]">
                    {Object.entries(payload.diagnostics[queue].statuses)
                      .map(([status, count]) => `${status}: ${count}`)
                      .join(" · ") || "No queued jobs"}
                  </p>
                  {Object.keys(payload.diagnostics[queue].failedByClass).length > 0 && (
                    <p className="mt-2 text-xs text-[#ffb7bd]">
                      {Object.entries(payload.diagnostics[queue].failedByClass)
                        .map(([failure, count]) => `${failure}: ${count}`)
                        .join(" · ")}
                    </p>
                  )}
                </section>
              ))}
            </div>
          </Panel>
          <Panel>
            <h2 className="text-2xl">Privacy-safe product signals</h2>
            <p className="mt-2 text-sm text-[#b8adc8]">
              Aggregate counts from the last {payload.productMeasurement.windowHours} hours. The
              event store contains no user ID, birth data, question text, card identity, URL, or
              report prose.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(payload.productMeasurement.events).length === 0 ? (
                <div>
                  <dt className="text-xs text-[#a99db5]">Current window</dt>
                  <dd>No events recorded</dd>
                </div>
              ) : (
                Object.entries(payload.productMeasurement.events).map(([event, count]) => (
                  <div key={event}>
                    <dt className="text-xs text-[#a99db5]">{event}</dt>
                    <dd>{count}</dd>
                  </div>
                ))
              )}
            </dl>
          </Panel>
          <Panel>
            <h2 className="text-2xl">Effective configuration</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(payload.configuration).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-[#a99db5]">{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-[#b8adc8]">
              Runtime publishing and rollback controls appear here only for operators; support
              access remains masked and read-only.
            </p>
          </Panel>
        </>
      )}

      <Panel>
        <h2 className="text-2xl">Masked trace lookup</h2>
        <p className="mt-2 text-sm text-[#b8adc8]">
          Enter an opaque reading, report, or order UUID. Results contain only entity type, status,
          and timestamp—never questions, profile facts, report content, or user identifiers.
        </p>
        <form
          className="mt-4 flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load(traceId);
          }}
        >
          <label className="min-w-64 flex-1">
            <span className="sr-only">Opaque trace ID</span>
            <input
              className="min-h-11 w-full rounded-2xl border border-white/15 bg-[#120e20] px-4"
              onChange={(event) => setTraceId(event.target.value)}
              placeholder="00000000-0000-4000-8000-000000000000"
              required
              value={traceId}
            />
          </label>
          <Button type="submit">Look up status</Button>
        </form>
        {payload?.trace && (
          <div className="mt-5">
            {payload.trace.entities.length === 0 ? (
              <p>No matching operational entity.</p>
            ) : (
              <ul className="grid gap-2">
                {payload.trace.entities.map((entity) => (
                  <li key={`${entity.type}-${entity.createdAt}`}>
                    {entity.type} · {entity.status} · {new Date(entity.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
            {role === "operator" &&
              payload.trace.entities.some(
                ({ type, status }) => type === "interpretation-job" && status === "failed",
              ) && (
                <Button className="mt-4" onClick={() => void retry("interpretation")}>
                  Retry failed interpretation job
                </Button>
              )}
            {role === "operator" &&
              payload.trace.entities.some(
                ({ type, status }) => type === "report-job" && status === "failed",
              ) && (
                <Button className="mt-4" onClick={() => void retry("report")}>
                  Retry failed report job
                </Button>
              )}
          </div>
        )}
        {message && (
          <p className="mt-4" role="status">
            {message}
          </p>
        )}
      </Panel>
      {role === "operator" && <OperatorConfigurationPanel />}
    </div>
  );
}
