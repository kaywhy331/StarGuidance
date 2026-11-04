/**
 * A full page load to an in-app path. Used where no half-finished ritual
 * state may survive (starting a new reading, signing out, leaving a ritual),
 * which a client-side route change would keep mounted.
 */
export function hardNavigate(path: string) {
  window.location.href = new URL(path, window.location.href).href;
}
