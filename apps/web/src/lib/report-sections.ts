export const PROFILE_REPORT_SECTION_PREVIEW = [
  { key: "overview", title: "Personal overview" },
  { key: "core-motivations", title: "Core motivations" },
  { key: "emotional-patterns", title: "Emotional patterns" },
  { key: "relationships", title: "Relationships" },
  { key: "communication-decisions", title: "Communication and decisions" },
  { key: "strengths", title: "Strengths" },
  { key: "internal-tensions", title: "Internal tensions" },
  { key: "growth-opportunities", title: "Growth opportunities" },
  { key: "astrology", title: "Western astrology" },
  { key: "numerology", title: "Pythagorean numerology" },
  { key: "bazi", title: "BaZi Four Pillars" },
  { key: "dreamspell", title: "Dreamspell Galactic Signature" },
  { key: "nine-star-ki", title: "Nine Star Ki" },
  { key: "planetary-angularity", title: "Planetary angularity and location" },
  { key: "cross-system-convergence", title: "Cross-system convergence" },
  { key: "cross-system-contradictions", title: "Cross-system contradictions" },
  { key: "practical-integration", title: "Practical integration prompts" },
] as const;

export type ProfileReportSectionKey = (typeof PROFILE_REPORT_SECTION_PREVIEW)[number]["key"];

/**
 * Report sections are persisted as `{ key, title, body }` only, so the
 * plain-language meaning and the technical footnote travel together in one
 * body string, separated by this marker. The shared presentation model splits
 * them for both the web atlas and the PDF, which keeps the two in parity
 * without a storage change. Sections written before the marker existed have
 * no technical note and render unchanged.
 */
export const REPORT_TECHNICAL_NOTE_MARKER = "\n\nTechnical notes: ";

export function joinReportSectionBody(meaning: string, technicalNote?: string): string {
  const note = technicalNote?.trim();
  return note ? `${meaning.trim()}${REPORT_TECHNICAL_NOTE_MARKER}${note}` : meaning.trim();
}

export function splitReportSectionBody(body: string): { meaning: string; technicalNote?: string } {
  const index = body.indexOf(REPORT_TECHNICAL_NOTE_MARKER);
  if (index < 0) return { meaning: body };
  const technicalNote = body.slice(index + REPORT_TECHNICAL_NOTE_MARKER.length).trim();
  return {
    meaning: body.slice(0, index).trim(),
    ...(technicalNote ? { technicalNote } : {}),
  };
}
