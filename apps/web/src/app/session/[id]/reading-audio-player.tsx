"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OracleStreamEvent } from "@starguidance/contracts";

import {
  deleteCachedAudioSection,
  readCachedAudioSection,
  timestampedAudioSection,
  writeCachedAudioSection,
  type ReadingAudioSection,
  type ReadingAudioWordTiming,
} from "./reading-audio-cache";

type PhaseEvent = Extract<OracleStreamEvent, { type: "phase" }>;
export type PlaybackState = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

export interface ReadingNarrationSnapshot {
  readonly sectionIndex: number | null;
  readonly state: PlaybackState;
  readonly visibleWordCount: number;
  readonly wordCount: number;
}

export function countNarrationWords(text: string): number {
  return text.match(/\S+/gu)?.length ?? 0;
}

export function synchronizedWordCount(
  currentTime: number,
  duration: number,
  timings: readonly ReadingAudioWordTiming[],
  totalWords: number,
): number {
  if (totalWords <= 0 || currentTime <= 0) return 0;
  if (timings.length > 0) {
    const spokenTimings = timings.filter(({ start }) => start <= currentTime + 0.04).length;
    if (spokenTimings === 0) return 0;
    if (spokenTimings >= timings.length) return totalWords;
    return Math.min(totalWords, Math.ceil((spokenTimings / timings.length) * totalWords));
  }
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(totalWords, Math.ceil((currentTime / duration) * totalWords));
}

export function playbackFailure(cause: unknown): { message: string; retryable: boolean } {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError")
    return {
      message: "Audio is ready, but playback is disabled by your browser or device settings.",
      retryable: true,
    };
  if (name === "NotSupportedError")
    return {
      message:
        "This browser could not decode the generated audio. Try generating the section again.",
      retryable: false,
    };
  return {
    message: "Playback could not start. Check this device’s audio output and try again.",
    retryable: false,
  };
}

function silentWave(): Blob {
  const sampleRate = 8_000;
  const frames = 80;
  const buffer = new ArrayBuffer(44 + frames);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + frames, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeText(36, "data");
  view.setUint32(40, frames, true);
  for (let index = 44; index < buffer.byteLength; index += 1) view.setUint8(index, 128);
  return new Blob([buffer], { type: "audio/wav" });
}

export function ReadingAudioPlayer({
  activeIndex,
  continuous,
  enabled,
  entries,
  onNarrationChange,
  readingId,
  target,
}: {
  activeIndex: number;
  continuous: boolean;
  enabled: boolean;
  entries: readonly PhaseEvent[];
  onNarrationChange?: (snapshot: ReadingNarrationSnapshot) => void;
  readingId: string;
  target: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cacheRef = useRef(new Map<string, { section: ReadingAudioSection; source: string }>());
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const entriesRef = useRef(entries);
  const loadedSectionRef = useRef<{ index: number; section: ReadingAudioSection } | undefined>(
    undefined,
  );
  const lastNarrationRef = useRef<ReadingNarrationSnapshot | undefined>(undefined);
  const narrationCallbackRef = useRef(onNarrationChange);
  const operationRef = useRef(0);
  const playbackRef = useRef<PlaybackState>("idle");
  const primeSourceRef = useRef<string | undefined>(undefined);
  const primedRef = useRef(false);
  const primingRef = useRef(false);
  const progressFrameRef = useRef<number | undefined>(undefined);
  const resetTimerRef = useRef<number | undefined>(undefined);
  const sectionIndexRef = useRef<number | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [sectionIndex, setSectionIndex] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    entriesRef.current = entries;
    narrationCallbackRef.current = onNarrationChange;
  }, [entries, onNarrationChange]);

  const emitNarration = useCallback((state = playbackRef.current) => {
    const index = sectionIndexRef.current;
    const audio = audioRef.current;
    const loaded = loadedSectionRef.current;
    const entry = index === null ? undefined : entriesRef.current[index];
    const wordCount = entry ? countNarrationWords(`${entry.heading}. ${entry.text}`) : 0;
    const visibleWordCount =
      index !== null && loaded?.index === index && audio
        ? synchronizedWordCount(
            audio.currentTime,
            audio.duration,
            loaded.section.wordTimings,
            wordCount,
          )
        : 0;
    const snapshot: ReadingNarrationSnapshot = {
      sectionIndex: index,
      state,
      visibleWordCount: state === "ended" ? wordCount : visibleWordCount,
      wordCount,
    };
    const previous = lastNarrationRef.current;
    if (
      previous?.sectionIndex === snapshot.sectionIndex &&
      previous.state === snapshot.state &&
      previous.visibleWordCount === snapshot.visibleWordCount &&
      previous.wordCount === snapshot.wordCount
    )
      return;
    lastNarrationRef.current = snapshot;
    narrationCallbackRef.current?.(snapshot);
  }, []);

  const transition = useCallback(
    (next: PlaybackState) => {
      playbackRef.current = next;
      setPlayback(next);
      emitNarration(next);
    },
    [emitNarration],
  );

  const stopProgressLoop = useCallback(() => {
    if (progressFrameRef.current !== undefined)
      window.cancelAnimationFrame(progressFrameRef.current);
    progressFrameRef.current = undefined;
  }, []);

  const startProgressLoop = useCallback(() => {
    stopProgressLoop();
    const tick = () => {
      emitNarration();
      if (playbackRef.current === "playing")
        progressFrameRef.current = window.requestAnimationFrame(tick);
    };
    progressFrameRef.current = window.requestAnimationFrame(tick);
  }, [emitNarration, stopProgressLoop]);

  const stopPlayback = useCallback(() => {
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    stopProgressLoop();
    sectionIndexRef.current = null;
    loadedSectionRef.current = undefined;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setSectionIndex(null);
    setMessage("");
    transition("idle");
  }, [stopProgressLoop, transition]);

  useEffect(() => {
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = undefined;
      stopPlayback();
    }, 0);
    return () => {
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = undefined;
    };
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
      stopProgressLoop();
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
      audioRef.current?.pause();
      for (const { source } of cacheRef.current.values()) URL.revokeObjectURL(source);
      cacheRef.current.clear();
      if (primeSourceRef.current) URL.revokeObjectURL(primeSourceRef.current);
    },
    [stopProgressLoop],
  );

  const primeAudioElement = useCallback(async (audio: HTMLAudioElement) => {
    if (primedRef.current || primingRef.current) return;
    primingRef.current = true;
    primeSourceRef.current ??= URL.createObjectURL(silentWave());
    audio.src = primeSourceRef.current;
    audio.currentTime = 0;
    try {
      await audio.play();
      primedRef.current = true;
      audio.pause();
    } catch {
      // A second explicit play remains available if the browser declines priming.
    } finally {
      if (audio.getAttribute("src") === primeSourceRef.current) {
        audio.removeAttribute("src");
        audio.load();
      }
      primingRef.current = false;
    }
  }, []);

  const startAudio = useCallback(
    async (audio: HTMLAudioElement, operation: number) => {
      try {
        await audio.play();
        if (operation !== operationRef.current) return;
        setMessage("");
        transition("playing");
        startProgressLoop();
      } catch (cause) {
        if (operation !== operationRef.current) return;
        const failure = playbackFailure(cause);
        transition(failure.retryable ? "ready" : "error");
        setMessage(failure.message);
      }
    },
    [startProgressLoop, transition],
  );

  const playSection = useCallback(
    async (index: number, priming: Promise<void> = Promise.resolve()) => {
      const entry = entriesRef.current[index];
      const audio = audioRef.current;
      if (!entry || !audio) return;

      const operation = operationRef.current + 1;
      operationRef.current = operation;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      sectionIndexRef.current = index;
      loadedSectionRef.current = undefined;
      setSectionIndex(index);
      setMessage("");
      transition("loading");
      await priming;
      if (operation !== operationRef.current) return;

      const cacheKey = `${readingId}:${target}:${entry.sequence}`;
      let stored = cacheRef.current.get(cacheKey);
      try {
        if (!stored) {
          let section = await readCachedAudioSection(cacheKey);
          if (operation !== operationRef.current) return;
          if (!section) {
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
            section = await timestampedAudioSection(response);
            if (operation !== operationRef.current) return;
            await writeCachedAudioSection(cacheKey, section);
          }
          const source = URL.createObjectURL(section.audio);
          stored = { section, source };
          cacheRef.current.set(cacheKey, stored);
        }

        if (operation !== operationRef.current) return;
        loadedSectionRef.current = { index, section: stored.section };
        audio.src = stored.source;
        audio.currentTime = 0;
        audio.load();
        transition("ready");
        await startAudio(audio, operation);
      } catch (cause) {
        if (controller.signal.aborted || operation !== operationRef.current) return;
        transition("error");
        setMessage(
          cause instanceof Error ? cause.message : "This audio section could not be prepared.",
        );
      }
    },
    [readingId, startAudio, target, transition],
  );

  const discardCurrentSection = useCallback(() => {
    const index = sectionIndexRef.current;
    const entry = index === null ? undefined : entriesRef.current[index];
    if (!entry) return;
    const cacheKey = `${readingId}:${target}:${entry.sequence}`;
    const stored = cacheRef.current.get(cacheKey);
    if (stored) URL.revokeObjectURL(stored.source);
    cacheRef.current.delete(cacheKey);
    void deleteCachedAudioSection(cacheKey);
  }, [readingId, target]);

  const handleEnded = useCallback(() => {
    stopProgressLoop();
    emitNarration("ended");
    const current = sectionIndexRef.current;
    const next = current === null ? 0 : current + 1;
    if (continuous && next < entriesRef.current.length) {
      void playSection(next);
      return;
    }
    transition("ended");
    setMessage(continuous ? "Audio reading complete." : "Section complete.");
  }, [continuous, emitNarration, playSection, stopProgressLoop, transition]);

  const handleClick = () => {
    const audio = audioRef.current;
    if (resetTimerRef.current !== undefined) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = undefined;
    }
    if (playback === "loading") {
      stopPlayback();
      return;
    }
    if (playback === "playing") {
      audio?.pause();
      stopProgressLoop();
      transition("paused");
      return;
    }
    if ((playback === "paused" || playback === "ready") && audio?.src) {
      void startAudio(audio, operationRef.current);
      return;
    }
    if (playback === "error") discardCurrentSection();
    const priming = audio ? primeAudioElement(audio) : Promise.resolve();
    void playSection(continuous ? 0 : activeIndex, priming);
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
  const visibleMessage = message && (playback === "error" || playback === "ready") ? message : null;

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
        onEnded={() => {
          if (!primingRef.current) handleEnded();
        }}
        onError={() => {
          if (primingRef.current) return;
          stopProgressLoop();
          transition("error");
          setMessage("The generated audio could not be decoded. Try generating the section again.");
        }}
        onLoadedMetadata={() => emitNarration()}
        onPause={() => {
          if (primingRef.current || playbackRef.current !== "playing") return;
          stopProgressLoop();
          transition("paused");
        }}
        onPlay={() => {
          if (primingRef.current) return;
          setMessage("");
          transition("playing");
          startProgressLoop();
        }}
        onTimeUpdate={() => emitNarration()}
        preload="metadata"
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
