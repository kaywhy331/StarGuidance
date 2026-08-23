export type Arcana = "major" | "minor";
export type Suit = "wands" | "cups" | "swords" | "pentacles";
export type CardOrientation = "upright" | "reversed";
export type ReversalMode = "reversals_enabled" | "upright_only";
export type PersonalizationMode = "pure_tarot" | "personalized_tarot";

export type ReversalFacet =
  | "blocked"
  | "internalized"
  | "delayed"
  | "imbalanced"
  | "excessive"
  | "deficient"
  | "avoided"
  | "releasing"
  | "recovering";

export interface TarotArtwork {
  readonly artworkId: string;
  readonly frontAsset: string;
  readonly backAsset: string;
  readonly backAssetAvif?: string | undefined;
  readonly altText: string;
  readonly artistCredit: string;
  readonly license: string;
  readonly source: string;
  readonly provenance: string;
  readonly focalPoint: { readonly x: number; readonly y: number };
  readonly crop: "center" | "top" | "bottom";
  readonly artworkVersion: string;
}

export interface TarotCard {
  readonly id: string;
  readonly name: string;
  readonly arcana: Arcana;
  readonly suit: Suit | null;
  readonly rank: string;
  readonly uprightThemes: readonly string[];
  readonly reversedThemes: readonly string[];
  /** Curated ways this card may express when reversed; never simple opposites. */
  readonly reversalFacets?: readonly ReversalFacet[];
  readonly eventTags: readonly string[];
  readonly reflectivePrompt: string;
  readonly contentVersion: string;
  readonly attribution: string;
  readonly artwork: TarotArtwork;
}

export interface SpreadPosition {
  readonly id: string;
  readonly displayName: string;
  readonly interpretiveFunction: string;
  readonly description: string;
  readonly order: number;
  readonly placement: {
    /** Zero-based visual grid column. Multiple cards may intentionally share a cell. */
    readonly column: number;
    /** Zero-based visual grid row. */
    readonly row: number;
    /** Clockwise rotation in degrees; Celtic Cross card two uses 90. */
    readonly rotation: number;
    /** Stacking order for cards occupying the same grid cell. */
    readonly layer: number;
  };
}

export interface SpreadContextPosition {
  readonly positionId: string;
  readonly displayName: string;
  readonly interpretiveFunction: string;
  readonly description: string;
}

export interface SpreadContextTemplate {
  readonly id: string;
  readonly name: string;
  readonly positions: readonly SpreadContextPosition[];
}

export interface SpreadCapabilityContract {
  /** Position IDs from which a conditional outlook may be inferred. */
  readonly trajectoryPositionIds: readonly string[];
  /** Position groups that structurally represent distinct paths or choices. */
  readonly alternativePositionGroups: readonly (readonly string[])[];
  /** No timing prose is permitted unless a reviewed method is named here. */
  readonly timingMethod: null | {
    readonly id: string;
    readonly positionIds: readonly string[];
  };
  /** Explicit relationships the whole-spread scan is allowed to analyze. */
  readonly linkedPositions: readonly {
    readonly id: string;
    readonly positionIds: readonly string[];
    readonly relationship: "sequence" | "compare" | "tension" | "integration";
  }[];
}

export interface Spread {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly estimatedMinutes: number;
  readonly entitlementClass: "standard";
  readonly version: string;
  readonly allowReversals: boolean;
  readonly optionalCut: boolean;
  readonly layout: {
    readonly columns: number;
    readonly rows: number;
    readonly kind:
      | "centered"
      | "horizontal"
      | "celtic-cross"
      | "horseshoe"
      | "relationship"
      | "matrix"
      | "legacy";
  };
  readonly contextTemplates?: readonly SpreadContextTemplate[];
  readonly capabilities?: SpreadCapabilityContract;
  readonly positions: readonly SpreadPosition[];
}

export interface DrawAssignment {
  readonly positionId: string;
  readonly cardId: string;
  readonly orientation: CardOrientation;
  readonly order: number;
}

export interface LockedDraw {
  readonly id: string;
  readonly deckVersion: string;
  readonly spreadId: string;
  readonly spreadVersion: string;
  readonly shuffleVersion: string;
  readonly assignments: readonly DrawAssignment[];
  /**
   * Public, non-secret evidence for draws finalized through the committed
   * ceremony. Historical draws created before v2 legitimately omit it.
   */
  readonly proof?:
    | {
        readonly entropyVersion: string;
        readonly serverSeedCommitment: string;
        readonly clientNonceHash: string;
        readonly cutIndex: number;
        readonly reversalMode: ReversalMode;
      }
    | undefined;
  readonly lockedAt: string;
}
