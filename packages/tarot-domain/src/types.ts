export type Arcana = "major" | "minor";
export type Suit = "wands" | "cups" | "swords" | "pentacles";
export type CardOrientation = "upright" | "reversed";

export interface TarotArtwork {
  readonly artworkId: string;
  readonly frontAsset: string;
  readonly backAsset: string;
  readonly backAssetAvif?: string;
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
  readonly lockedAt: string;
}
