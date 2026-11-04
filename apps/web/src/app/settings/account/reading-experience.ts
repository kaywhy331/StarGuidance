"use client";

/**
 * Device-local reading choices that the server does not store yet (adding
 * them to user_settings would need a migration). The ritual can read these
 * with the exported helpers; until then they only describe the default.
 */
export const REVERSALS_KEY = "sg:reading:reversals";
export const PERSONALIZE_KEY = "sg:reading:personalize";

export function readDeviceBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === "true" ? true : value === "false" ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writeDeviceBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Blocked storage keeps the default for this visit.
  }
}

/** Whether reversed cards are welcome in new readings on this device (default on). */
export function reversalsEnabledOnDevice(): boolean {
  return readDeviceBoolean(REVERSALS_KEY, true);
}

/** Whether new readings may draw on the birth profile on this device (default on). */
export function personalizationEnabledOnDevice(): boolean {
  return readDeviceBoolean(PERSONALIZE_KEY, true);
}
