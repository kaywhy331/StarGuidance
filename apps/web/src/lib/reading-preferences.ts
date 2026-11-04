"use client";

import { useCallback, useEffect, useState } from "react";

import {
  savedMotionPreference,
  setMotionPreference,
  useMotionPreference,
} from "./motion-preference";
const SOUND_KEY = "sg:reading:sound";
const AMBIENCE_KEY = "sg:reading:ambience";
const NARRATION_KEY = "sg:reading:narration";

export interface ReadingPreferenceSeed {
  displayName: string;
  soundEnabled: boolean;
  reducedMotion: boolean;
}

function storedBoolean(key: string): boolean | undefined {
  try {
    const value = window.localStorage.getItem(key);
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
  const { reducedMotion, systemReducedMotion } = useMotionPreference();
  const [sound, setSound] = useState(() =>
    initial
      ? initial.soundEnabled
      : typeof window === "undefined"
        ? true
        : (storedBoolean(SOUND_KEY) ?? true),
  );
  const [ambience, setAmbience] = useState(() =>
    typeof window === "undefined" ? false : (storedBoolean(AMBIENCE_KEY) ?? false),
  );
  const [narration, setNarration] = useState(() =>
    typeof window === "undefined" ? false : (storedBoolean(NARRATION_KEY) ?? false),
  );

  useEffect(() => {
    if (initial) {
      if (savedMotionPreference() === undefined) setMotionPreference(initial.reducedMotion);
      return;
    }
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
          if (savedMotionPreference() === undefined)
            setMotionPreference(payload.settings.reducedMotion);
          setSound(payload.settings.soundEnabled);
          persistBoolean(SOUND_KEY, payload.settings.soundEnabled);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [initial]);

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
    if (systemReducedMotion) return;
    const next = !reducedMotion;
    setMotionPreference(next);
    persistRemote(next, sound);
  }, [persistRemote, reducedMotion, sound, systemReducedMotion]);
  const toggleSound = useCallback(() => {
    setSound((current) => {
      const next = !current;
      persistBoolean(SOUND_KEY, next);
      persistRemote(reducedMotion, next);
      return next;
    });
  }, [persistRemote, reducedMotion]);
  const toggleAmbience = useCallback(() => {
    setAmbience((current) => {
      const next = !current;
      persistBoolean(AMBIENCE_KEY, next);
      return next;
    });
  }, []);
  const toggleNarration = useCallback(() => {
    setNarration((current) => {
      const next = !current;
      persistBoolean(NARRATION_KEY, next);
      return next;
    });
  }, []);

  return {
    ambience,
    displayName,
    narration,
    reducedMotion,
    sound,
    toggleAmbience,
    toggleNarration,
    toggleReducedMotion,
    toggleSound,
  };
}
