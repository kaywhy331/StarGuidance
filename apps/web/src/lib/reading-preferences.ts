"use client";

import { useCallback, useEffect, useState } from "react";

const REDUCED_MOTION_KEY = "sg:reading:reduced-motion";
const SOUND_KEY = "sg:reading:sound";

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

export function useReadingPreferences() {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      storedBoolean(window.localStorage, REDUCED_MOTION_KEY) ??
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  });
  const [sound, setSound] = useState(() =>
    typeof window === "undefined"
      ? false
      : (storedBoolean(window.localStorage, SOUND_KEY) ?? false),
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (storedBoolean(window.localStorage, REDUCED_MOTION_KEY) === undefined)
        setReducedMotion(event.matches);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion((current) => {
      const next = !current;
      persistBoolean(REDUCED_MOTION_KEY, next);
      return next;
    });
  }, []);
  const toggleSound = useCallback(() => {
    setSound((current) => {
      const next = !current;
      persistBoolean(SOUND_KEY, next);
      return next;
    });
  }, []);

  return { reducedMotion, sound, toggleReducedMotion, toggleSound };
}
