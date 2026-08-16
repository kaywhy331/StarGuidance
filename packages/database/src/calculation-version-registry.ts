import { CALCULATION_SYSTEM_VERSIONS } from "@starguidance/contracts";

/**
 * The rows the seed registers into calculation_versions, derived from the
 * shared canonical map (gap G26) so a snapshot can never record a version
 * the registry does not contain. Status is the registry's own concern —
 * certification state, not existence — and is the one thing this module
 * declares beyond the shared constants.
 */
export const REGISTERED_CALCULATION_VERSIONS = [
  { system: "numerology", version: CALCULATION_SYSTEM_VERSIONS.numerology, status: "implemented" },
  {
    system: "dreamspell",
    version: CALCULATION_SYSTEM_VERSIONS.dreamspell,
    status: "pending-certification",
  },
  {
    system: "nineStarKi",
    version: CALCULATION_SYSTEM_VERSIONS.nineStarKi,
    status: "pending-certification",
  },
  {
    system: "westernAstrology",
    version: CALCULATION_SYSTEM_VERSIONS.westernAstrology,
    status: "unavailable",
  },
  { system: "bazi", version: CALCULATION_SYSTEM_VERSIONS.bazi, status: "unavailable" },
  {
    system: "planetaryAngularity",
    version: CALCULATION_SYSTEM_VERSIONS.planetaryAngularity,
    status: "unavailable",
  },
] as const;
