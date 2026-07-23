export type Arcana = "major" | "minor";
export type Suit = "wands" | "cups" | "swords" | "pentacles";
export type CardOrientation = "upright" | "reversed";

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
}

export interface SpreadPosition {
  readonly id: string;
  readonly displayName: string;
  readonly interpretiveFunction: string;
  readonly description: string;
  readonly order: number;
  readonly placement: { readonly x: number; readonly y: number; readonly rotation: number };
}

export interface Spread {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly allowReversals: boolean;
  readonly optionalCut: boolean;
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
  readonly profileSnapshotId: string;
  readonly assignments: readonly DrawAssignment[];
  readonly lockedAt: string;
}
