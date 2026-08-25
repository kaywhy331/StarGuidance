"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OracleStreamEvent } from "@starguidance/contracts";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
type PlaybackState = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

const MAX_SECTION_AUDIO_BYTES = 12 * 1024 * 1024;

export async function boundedAudioBlob(response: Response): Promise<Blob> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_SECTION_AUDIO_BYTES) throw new Error("Audio section is too large.");
  if (!response.body) throw new Error("Audio section is empty.");

  const reader = response.body.getReader();
  const parts: ArrayBuffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_SECTION_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error("Audio section is too large.");
    }
    parts.push(Uint8Array.from(value).buffer);
  }
  if (received === 0) throw new Error("Audio section is empty.");
  return new Blob(parts, { type: "audio/mpeg" });
}

export function ReadingAudioPlayer({
  activeIndex,
  continuous,
  enabled,
  entries,
  readingId,
  target,
}: {
  activeIndex: number;
  continuous: boolean;
  enabled: boolean;
  entries: readonly PhaseEvent[];
  readingId: string;
  target: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cacheRef = useRef(new Map<string, string>());
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const entriesRef = useRef(entries);
  const operationRef = useRef(0);
  const sectionIndexRef = useRef<number | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [sectionIndex, setSectionIndex] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const stopPlayback = useCallback(() => {
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    sectionIndexRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlayback("idle");
    setSectionIndex(null);
    setMessage("");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(stopPlayback, 0);
    return () => window.clearTimeout(timer);
  }, [activeIndex, continuous, readingId, stopPlayback, target]);

  useEffect(() => {
    if (enabled) return;
    const timer = window.setTimeout(stopPlayback, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, stopPlayback]);

  useEffect(
    () => () => {
      operationRef.current += 1;
      controllerRef.current?.abort();
      audioRef.current?.pause();
      for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
      cacheRef.current.clear();
    },
    [],
  );

  const playSection = useCallback(
    async (index: number) => {
      const entry = entriesRef.current[index];
      const audio = audioRef.current;
      if (!entry || !audio) return;

      const operation = operationRef.current + 1;
      operationRef.current = operation;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      sectionIndexRef.current = index;
      setSectionIndex(index);
      setMessage("");

      const cacheKey = `${readingId}:${target}:${entry.sequence}`;
      let source = cacheRef.current.get(cacheKey);
      try {
        if (!source) {
          setPlayback("loading");
          const response = await fetch(`/api/readings/${encodeURIComponent(readingId)}/audio`, {
            method: "POST",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ target, sequence: entry.sequence }),
            signal: controller.signal,
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => undefined)) as
              { error?: string } | undefined;
            throw new Error(payload?.error ?? "This audio section could not be prepared.");
          }
          const blob = await boundedAudioBlob(response);
          if (operation !== operationRef.current) return;
          source = URL.createObjectURL(blob);
          cacheRef.current.set(cacheKey, source);
        }

        if (operation !== operationRef.current) return;
        audio.src = source;
        audio.currentTime = 0;
        setPlayback("ready");
        try {
          await audio.play();
          if (operation === operationRef.current) setPlayback("playing");
        } catch {
          if (operation === operationRef.current) {
            setPlayback("ready");
            setMessage("Audio is prepared. Press play once more to begin.");
          }
        }
      } catch (cause) {
        if (controller.signal.aborted || operation !== operationRef.current) return;
        setPlayback("error");
        setMessage(
          cause instanceof Error ? cause.message : "This audio section could not be prepared.",
        );
      }
    },
    [readingId, target],
  );

  const handleEnded = useCallback(() => {
    const current = sectionIndexRef.current;
    const next = current === null ? 0 : current + 1;
    if (continuous && next < entriesRef.current.length) {
      void playSection(next);
      return;
    }
    setPlayback("ended");
    setMessage(continuous ? "Audio reading complete." : "Section complete.");
  }, [continuous, playSection]);

  const handleClick = () => {
    const audio = audioRef.current;
    if (playback === "loading") {
      stopPlayback();
      return;
    }
    if (playback === "playing") {
      audio?.pause();
      setPlayback("paused");
      return;
    }
    if ((playback === "paused" || playback === "ready") && audio?.src) {
      void audio
        .play()
        .then(() => setPlayback("playing"))
        .catch(() => setMessage("Your browser blocked playback. Press play again."));
      return;
    }
    void playSection(continuous ? 0 : activeIndex);
  };

  if (!enabled || entries.length === 0) return null;

  const accessibleLabel =
    playback === "loading"
      ? "Cancel audio"
      : playback === "playing"
        ? "Pause audio"
        : playback === "paused" || playback === "ready"
          ? "Resume audio"
          : playback === "error"
            ? "Retry audio"
            : continuous
              ? "Play audio reading"
              : "Play this section";
  const visibleLabel =
    playback === "loading"
      ? "Cancel"
      : playback === "playing"
        ? "Pause"
        : playback === "paused" || playback === "ready"
          ? "Resume"
          : playback === "error"
            ? "Retry audio"
            : "Play audio";
  const activeHeading = sectionIndex === null ? undefined : entries[sectionIndex]?.heading;

  const visibleMessage =
    message && (playback === "error" || playback === "ready") ? message : undefined;

  return (
    <span className="reading-audio-control">
      <button
        aria-label={accessibleLabel}
        className="reading-audio-trigger"
        data-state={playback}
        data-testid="reading-audio-trigger"
        onClick={handleClick}
        title={message || activeHeading}
        type="button"
      >
        <span aria-hidden="true">{playback === "playing" ? "Ⅱ" : "▶"}</span>
        <span>{visibleLabel}</span>
        {sectionIndex !== null && continuous && (
          <small>
            {sectionIndex + 1}/{entries.length}
          </small>
        )}
      </button>
      <audio
        aria-hidden="true"
        onEnded={handleEnded}
        onPause={() => setPlayback((current) => (current === "playing" ? "paused" : current))}
        onPlay={() => setPlayback("playing")}
        preload="none"
        ref={audioRef}
      />
      <span aria-live="polite" className="sr-only">
        {message || (activeHeading ? `Audio section: ${activeHeading}` : "")}
      </span>
      {visibleMessage && (
        <span className="reading-audio-message" role="status">
          {visibleMessage}
        </span>
      )}
    </span>
  );
}
