import type { ProfileSnapshot } from "@starguidance/contracts";

/**
 * The snapshot contains versioned derived traits, never the raw facts used to
 * calculate them. Raw birth input lives only in the authenticated-encryption
 * envelope stored as the private-profile-input component.
 */
export function profileDerivedPayload(snapshot: ProfileSnapshot) {
  return { snapshot };
}
