"use client";

import { useSyncExternalStore } from "react";

const KEY = "sg:reading:reduced-motion";
const EVENT = "sg:motion-preference";
const QUERY = "(prefers-reduced-motion: reduce)";
let memoryPreference: boolean | undefined;

export function savedMotionPreference(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "true" ? true : value === "false" ? false : memoryPreference;
  } catch {
    return memoryPreference;
  }
}

export function setMotionPreference(reduced: boolean) {
  memoryPreference = reduced;
  try {
    window.localStorage.setItem(KEY, String(reduced));
  } catch {
    // The in-memory preference still works when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    memoryPreference =
      event.newValue === "true" ? true : event.newValue === "false" ? false : undefined;
    onChange();
  };
  window.addEventListener("storage", storageChanged);
  window.addEventListener(EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(EVENT, onChange);
  };
}

function systemSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function snapshot() {
  // The operating-system accessibility preference is always the minimum.
  return systemSnapshot() || savedMotionPreference() === true;
}

const serverSnapshot = () => true;

export function useMotionPreference() {
  const reducedMotion = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const systemReducedMotion = useSyncExternalStore(subscribe, systemSnapshot, serverSnapshot);
  return { reducedMotion, systemReducedMotion, setReducedMotion: setMotionPreference };
}
