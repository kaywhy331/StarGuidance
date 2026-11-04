/** Shortens at a word boundary so a title never ends mid-word. */
export function truncateAtWord(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const wasCut = clean.endsWith("…");
  const base = wasCut ? clean.slice(0, -1).trimEnd() : clean;
  if (!wasCut && base.length <= limit) return base;
  const slice = base.slice(0, Math.min(limit, base.length));
  const boundary = slice.lastIndexOf(" ");
  const cutAtWord = boundary > 0 && (wasCut || boundary > limit * 0.5);
  const trimmed = (cutAtWord ? slice.slice(0, boundary) : slice).replace(/[\s,;:.!?-]+$/u, "");
  return `${trimmed}…`;
}
