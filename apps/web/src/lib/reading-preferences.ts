"use client";

import { useCallback, useEffect, useState } from "react";

const REDUCED_MOTION_KEY = "sg:reading:reduced-motion";
const SOUND_KEY = "sg:reading:sound";

export interface ReadingPreferenceSeed {
  displayName: string;
  soundEnabled: boolean;
  reducedMotion: boolean;
}

function storedBoolean(storage: Storage, key: string): boolean | undefined {
  try {
    const value = storage.getItem(key);
    return value === "true" ? true : value === "false" ? false : undefined;
  } catch {
    return undefined;
  }
}

function persistBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // A blocked preference store must not block the reading itself.
  }
}

export function useReadingPreferences(initial?: ReadingPreferenceSeed) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "Reader");
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (initial) return initial.reducedMotion;
    if (typeof window === "undefined") return false;
    return (
      storedBoolean(window.localStorage, REDUCED_MOTION_KEY) ??
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  });
  const [sound, setSound] = useState(() =>
    initial
      ? initial.soundEnabled
      : typeof window === "undefined"
        ? false
        : (storedBoolean(window.localStorage, SOUND_KEY) ?? false),
  );

  useEffect(() => {
    if (initial) return;
    let active = true;
    void fetch("/api/settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          settings: ReadingPreferenceSeed;
          settingsPersisted: boolean;
        };
        if (!active) return;
        setDisplayName(payload.settings.displayName);
        if (payload.settingsPersisted) {
          setReducedMotion(payload.settings.reducedMotion);
          setSound(payload.settings.soundEnabled);
          persistBoolean(REDUCED_MOTION_KEY, payload.settings.reducedMotion);
          persistBoolean(SOUND_KEY, payload.settings.soundEnabled);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [initial]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (storedBoolean(window.localStorage, REDUCED_MOTION_KEY) === undefined)
        setReducedMotion(event.matches);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const persistRemote = useCallback((nextReducedMotion: boolean, nextSound: boolean) => {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "update-reading-preferences",
        reducedMotion: nextReducedMotion,
        soundEnabled: nextSound,
      }),
    }).catch(() => undefined);
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion((current) => {
      const next = !current;
      persistBoolean(REDUCED_MOTION_KEY, next);
      persistRemote(next, sound);
      return next;
    });
  }, [persistRemote, sound]);
  const toggleSound = useCallback(() => {
    setSound((current) => {
      const next = !current;
      persistBoolean(SOUND_KEY, next);
      persistRemote(reducedMotion, next);
      return next;
    });
  }, [persistRemote, reducedMotion]);

  return { displayName, reducedMotion, sound, toggleReducedMotion, toggleSound };
}
