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
