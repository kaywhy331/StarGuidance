"use client";

import { useEffect, useRef } from "react";
import type { ReadingResult } from "@starguidance/contracts";

export function ReadingDetailsDrawer({
  open,
  result,
  onClose,
}: {
  open: boolean;
  result?: ReadingResult | undefined;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby="reading-details-title"
      className="reading-details-drawer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="details-drawer-handle" aria-hidden="true" />
      <header>
        <div>
          <p>Structured reading</p>
          <h2 id="reading-details-title">Reading details</h2>
        </div>
        <button aria-label="Close reading details" onClick={onClose} type="button">
          Close
        </button>
      </header>
      {!result ? (
        <p className="details-empty">Details become available after the cards are revealed.</p>
      ) : (
        <div className="details-drawer-scroll">
          <section>
            <h3>{result.title}</h3>
            <p>{result.synthesis}</p>
          </section>
          <details>
            <summary>Card-by-card interpretation</summary>
            {result.cards.map((card) => (
              <article key={`${card.positionId}-${card.cardId}`}>
                <h3>
                  {card.positionId.replaceAll("-", " ")} · {card.orientation}
                </h3>
                <p>{card.traditionalMeaning}</p>
                <p>{card.personalizedMeaning}</p>
                <p>{card.questionConnection}</p>
              </article>
            ))}
          </details>
          <details>
            <summary>Trajectory and conditions</summary>
            <p>{result.likelyTrajectory.summary}</p>
            <ul>
              {result.likelyTrajectory.conditions.map((condition) => (
                <li key={condition}>{condition}</li>
              ))}
            </ul>
            <h3>Alternate trajectory</h3>
            <p>{result.likelyTrajectory.alternateTrajectory}</p>
          </details>
          <details>
            <summary>Agency and reflection</summary>
            <ul>
              {result.userAgency.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="details-reflection">{result.reflectionQuestion}</p>
          </details>
          <details>
            <summary>Uncertainty and disconfirming evidence</summary>
            <p>{result.uncertainty}</p>
            <ul>
              {result.disconfirmingEvidence.map((evidence) => (
                <li key={evidence}>{evidence}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </dialog>
  );
}
