"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, LoadingState, Panel } from "@starguidance/design-system";

type ConfigurationDomain = "content" | "prompts" | "commerce" | "features" | "models";

interface ConfigurationVersion {
  id: string;
  domain: ConfigurationDomain;
  version: number;
  status: "draft" | "approved" | "published" | "archived";
  payload: unknown;
  createdByCurrentOperator: boolean;
  approvedByCurrentOperator: boolean;
  approvedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface ConfigurationPayload {
  effective: Record<ConfigurationDomain, unknown> & {
    versions: Record<ConfigurationDomain, number | null>;
  };
  versions: ConfigurationVersion[];
  content: { targetType: "deck" | "spread" | "product"; id: string; active: boolean }[];
  approvalPolicy: string;
}

const domains: ConfigurationDomain[] = ["content", "prompts", "commerce", "features", "models"];

export function OperatorConfigurationPanel() {
  const [payload, setPayload] = useState<ConfigurationPayload>();
  const [domain, setDomain] = useState<ConfigurationDomain>("features");
  const [draft, setDraft] = useState("");
  const [modelTarget, setModelTarget] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/operations/configuration", { cache: "no-store" });
    const body = (await response.json()) as ConfigurationPayload & { error?: string };
    if (!response.ok) return setMessage(body.error ?? "Runtime configuration is unavailable.");
    setPayload(body);
    setDraft(JSON.stringify(body.effective[domain], null, 2));
  }, [domain]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const mutate = async (body: unknown, success: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/operations/configuration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      setMessage(response.ok ? success : (result.error ?? "The operation did not complete."));
      if (response.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  if (!payload) return <LoadingState label="Loading governed runtime configuration…" />;

  return (
    <div className="grid gap-6">
      <Panel>
        <p className="text-xs tracking-[.16em] text-[#d8b56d] uppercase">Two-person control</p>
        <h2 className="mt-2 text-2xl">Publish and roll back configuration</h2>
        <p className="mt-2 text-sm text-[#b8adc8]">{payload.approvalPolicy}</p>
        <form
          className="mt-5 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              void mutate(
                { action: "create-draft", domain, payload: JSON.parse(draft) as unknown },
                `Draft created for ${domain}. A second operator can now approve it.`,
              );
            } catch {
              setMessage("Draft JSON is invalid.");
            }
          }}
        >
          <label>
            <span className="mb-2 block text-sm">Configuration domain</span>
            <select
              className="min-h-11 w-full rounded-2xl border border-white/15 bg-[#120e20] px-4"
              onChange={(event) => {
                const next = event.target.value as ConfigurationDomain;
                setDomain(next);
                setDraft(JSON.stringify(payload.effective[next], null, 2));
              }}
              value={domain}
            >
              {domains.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-sm">Validated configuration payload</span>
            <textarea
              className="min-h-64 w-full rounded-2xl border border-white/15 bg-[#120e20] p-4 font-mono text-sm"
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              value={draft}
            />
          </label>
          <Button disabled={busy} type="submit">
            Create governed draft
          </Button>
        </form>

        <div className="mt-6 grid gap-3">
          {payload.versions.map((version) => (
            <article className="rounded-2xl border border-white/10 p-4" key={version.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong>
                    {version.domain} v{version.version}
                  </strong>
                  <p className="text-sm text-[#b8adc8]">{version.status}</p>
                  <small className="text-[#92879e]">
                    {version.createdByCurrentOperator
                      ? "Created by you"
                      : "Created by another operator"}
                    {version.approvedAt
                      ? version.approvedByCurrentOperator
                        ? " · approved by you"
                        : " · independently approved"
                      : ""}
                  </small>
                </div>
                <div className="flex flex-wrap gap-2">
                  {version.status === "draft" && !version.createdByCurrentOperator && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          { action: "approve", configurationId: version.id },
                          `Approved ${version.domain} v${version.version}.`,
                        )
                      }
                      variant="secondary"
                    >
                      Approve
                    </Button>
                  )}
                  {version.status === "approved" && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          { action: "publish", configurationId: version.id },
                          `Published ${version.domain} v${version.version}.`,
                        )
                      }
                    >
                      Publish
                    </Button>
                  )}
                  {version.status === "archived" && version.approvedAt && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          {
                            action: "rollback",
                            domain: version.domain,
                            targetVersion: version.version,
                            confirmation: "ROLL BACK",
                          },
                          `Rolled ${version.domain} back to v${version.version}.`,
                        )
                      }
                      variant="secondary"
                    >
                      Roll back
                    </Button>
                  )}
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-[#d8b56d]">
                  Review immutable payload
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-black/20 p-3 text-xs whitespace-pre-wrap text-[#c9bfd4]">
                  {JSON.stringify(version.payload, null, 2)}
                </pre>
              </details>
            </article>
          ))}
        </div>
      </Panel>

      <Panel>
        <p className="text-xs tracking-[.16em] text-[#ffb7bd] uppercase">Immediate restriction</p>
        <h2 className="mt-2 text-2xl">Kill switches</h2>
        <p className="mt-2 text-sm text-[#b8adc8]">
          These actions only disable capability. Re-enabling uses a reviewed configuration or an
          explicit audited content restoration.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            disabled={busy}
            onClick={() =>
              void mutate(
                { action: "kill-switch", targetType: "ai", confirmation: "DISABLE NOW" },
                "Live AI disabled. Deterministic readings remain available.",
              )
            }
            variant="secondary"
          >
            Disable live AI
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void mutate(
                { action: "kill-switch", targetType: "payments", confirmation: "DISABLE NOW" },
                "New report purchases disabled.",
              )
            }
            variant="secondary"
          >
            Disable purchases
          </Button>
        </div>
        <form
          className="mt-4 flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              {
                action: "kill-switch",
                targetType: "model",
                targetId: modelTarget,
                confirmation: "DISABLE NOW",
              },
              `Model ${modelTarget} disabled for new generation attempts.`,
            );
          }}
        >
          <label className="min-w-64 flex-1">
            <span className="sr-only">Approved model identifier to disable</span>
            <input
              className="min-h-11 w-full rounded-2xl border border-white/15 bg-[#120e20] px-4"
              onChange={(event) => setModelTarget(event.target.value)}
              placeholder="Approved model identifier"
              required
              value={modelTarget}
            />
          </label>
          <Button disabled={busy} type="submit" variant="secondary">
            Disable model
          </Button>
        </form>
      </Panel>

      <Panel>
        <h2 className="text-2xl">Published content switches</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {payload.content.map((target) => (
            <div
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 p-3"
              key={`${target.targetType}:${target.id}`}
            >
              <span>
                <strong>{target.id}</strong>
                <small className="block text-[#b8adc8]">{target.targetType}</small>
              </span>
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    {
                      action: "set-content-active",
                      targetType: target.targetType,
                      targetId: target.id,
                      active: !target.active,
                      confirmation: "APPLY",
                    },
                    `${target.id} ${target.active ? "disabled" : "restored"}.`,
                  )
                }
                variant="secondary"
              >
                {target.active ? "Disable" : "Restore"}
              </Button>
            </div>
          ))}
        </div>
      </Panel>

      {message && (
        <p role="status" className="rounded-2xl border border-white/10 bg-[#171124] p-4">
          {message}
        </p>
      )}
    </div>
  );
}
