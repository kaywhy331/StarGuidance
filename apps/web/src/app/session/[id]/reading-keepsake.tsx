"use client";

/* eslint-disable @next/next/no-img-element -- Authored tarot art is served as static SVG/AVIF. */
import { forwardRef } from "react";
import type { ReadingResult } from "@starguidance/contracts";

import type { DealtCardView } from "./reading-types";

/** One card as the keepsake shows it. */
export interface KeepsakeCard {
  positionId: string;
  /** The spread position, e.g. "Situation". */
  positionName: string;
  /** The card's name, e.g. "The High Priestess". */
  name: string;
  orientation: "upright" | "reversed";
  /** Front artwork; omitted cards show a quiet placeholder. */
  imageSrc?: string;
  imageAlt?: string;
  /** What this card says in this position for this question. */
  interpretation?: string;
}

/** One whole-reading section, e.g. "Your answer". */
export interface KeepsakeSection {
  id: string;
  heading: string;
  text: string;
}

export interface KeepsakeFollowUp {
  id: string;
  /** The reader's own words, when available. */
  question?: string;
  answer: string;
}

export interface ReadingKeepsakeProps {
  question: string;
  /** ISO timestamp of the reading. */
  createdAt?: string;
  spreadName?: string;
  cards: readonly KeepsakeCard[];
  sections: readonly KeepsakeSection[];
  followUps?: readonly KeepsakeFollowUp[];
  /** Re-opens the passage-by-passage view. Omit to hide the action. */
  onReplay?: () => void;
  replayLabel?: string;
  /** Show the "Print / Save as PDF" action (default true). */
  printable?: boolean;
  /** Heading level text; defaults to "Your reading". */
  title?: string;
}

/** Maps the dealt cards and (optionally) the interpretation onto keepsake
 * cards, in spread order. */
export function keepsakeCardsFrom(
  cards: readonly DealtCardView[],
  result?: Pick<ReadingResult, "cards">,
): KeepsakeCard[] {
  return cards.map((card) => {
    const interpreted = result?.cards.find(({ positionId }) => positionId === card.positionId);
    return {
      positionId: card.positionId,
      positionName: card.positionName,
      name: card.name,
      orientation: card.orientation,
      imageSrc: card.artwork.frontAsset,
      imageAlt: card.artwork.altText,
      ...(interpreted ? { interpretation: interpreted.positionInterpretation } : {}),
    };
  });
}

/** The whole-reading sections of a result, in reading order, with plain
 * headings. Sections the spread does not support (null) are left out. */
export function keepsakeSectionsFrom(result: ReadingResult): KeepsakeSection[] {
  const sections: (KeepsakeSection | undefined)[] = [
    { id: "direct-answer", heading: "Your answer", text: result.directAnswer },
    {
      id: "overall-pattern",
      heading: "The thread through your cards",
      text: result.overallPattern,
    },
    { id: "synthesis", heading: "How the cards speak together", text: result.synthesis },
    result.likelyTrajectory
      ? {
          id: "likely-trajectory",
          heading: "Where this seems to be heading",
          text: result.likelyTrajectory,
        }
      : undefined,
    result.alternatePath
      ? { id: "alternate-path", heading: "Another way it could go", text: result.alternatePath }
      : undefined,
    result.timing ? { id: "timing", heading: "Timing", text: result.timing } : undefined,
    { id: "user-agency", heading: "Your move", text: result.userAgency },
    result.personalizationLens
      ? {
          id: "personal-lens",
          heading: "Through your own patterns",
          text: result.personalizationLens.observations.join(" "),
        }
      : undefined,
    { id: "reflection", heading: "A question to carry", text: result.reflectionPrompt },
    { id: "uncertainty", heading: "What the cards can’t know", text: result.uncertaintyNote },
  ];
  return sections.filter((section): section is KeepsakeSection => Boolean(section));
}

function formattedDate(iso?: string) {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * The finished reading on one page: question, date, spread, every card with
 * its position meaning, and the whole-reading sections. Works for members,
 * guests, and the saved-reading page alike, and prints cleanly.
 */
export const ReadingKeepsake = forwardRef<HTMLHeadingElement, ReadingKeepsakeProps>(
  function ReadingKeepsake(
    {
      question,
      createdAt,
      spreadName,
      cards,
      sections,
      followUps = [],
      onReplay,
      replayLabel = "Replay the reading",
      printable = true,
      title = "Your reading",
    },
    headingRef,
  ) {
    const date = formattedDate(createdAt);
    return (
      <article
        aria-labelledby="reading-keepsake-heading"
        className="reading-keepsake"
        data-testid="reading-keepsake"
      >
        <header className="reading-keepsake__header">
          <p className="reading-section-eyebrow">
            {[spreadName, date].filter(Boolean).join(" · ") || "Kept reading"}
          </p>
          <h2 id="reading-keepsake-heading" ref={headingRef} tabIndex={-1}>
            {title}
          </h2>
          <blockquote className="reading-keepsake__question">
            <span>You asked</span>
            {question}
          </blockquote>
        </header>

        <ol aria-label="Your cards" className="reading-keepsake__cards">
          {cards.map((card) => (
            <li key={card.positionId}>
              <figure>
                {card.imageSrc ? (
                  <img
                    alt={card.imageAlt ?? card.name}
                    className={card.orientation === "reversed" ? "card-art-reversed" : undefined}
                    decoding="async"
                    loading="lazy"
                    src={card.imageSrc}
                  />
                ) : (
                  <span aria-hidden="true" className="reading-keepsake__card-placeholder">
                    ✦
                  </span>
                )}
                <figcaption>
                  <span className="reading-keepsake__position">{card.positionName}</span>
                  <strong>{card.name}</strong>
                  {card.orientation === "reversed" && (
                    <em className="reading-keepsake__orientation">Reversed</em>
                  )}
                </figcaption>
              </figure>
              {card.interpretation && <p>{card.interpretation}</p>}
            </li>
          ))}
        </ol>

        <div className="reading-keepsake__sections">
          {sections.map((section) => (
            <section aria-labelledby={`keepsake-${section.id}`} key={section.id}>
              <h3 id={`keepsake-${section.id}`}>{section.heading}</h3>
              <p>{section.text}</p>
            </section>
          ))}
        </div>

        {followUps.length > 0 && (
          <section aria-labelledby="keepsake-follow-ups" className="reading-keepsake__follow-ups">
            <h3 id="keepsake-follow-ups">
              Follow-up{followUps.length === 1 ? "" : "s"} on these cards
            </h3>
            {followUps.map((entry) => (
              <div key={entry.id}>
                {entry.question && (
                  <p className="reading-keepsake__follow-up-question">
                    <span>You asked</span>
                    {entry.question}
                  </p>
                )}
                <p>{entry.answer}</p>
              </div>
            ))}
          </section>
        )}

        {(onReplay || printable) && (
          <div className="reading-keepsake__actions">
            {onReplay && (
              <button className="ritual-action" onClick={onReplay} type="button">
                {replayLabel}
              </button>
            )}
            {printable && (
              <button
                className="ritual-action is-quiet"
                onClick={() => window.print()}
                type="button"
              >
                Print / Save as PDF
              </button>
            )}
          </div>
        )}
      </article>
    );
  },
);
