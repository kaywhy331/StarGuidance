"use client";

import { useState } from "react";
import Link from "next/link";

import { PrivateSigil } from "./private-sigil";
import { primeRitualAudio } from "./ritual-audio";

export function RitualControls({
  animationManaged = false,
  ambience = false,
  controlsLabel = "Reading controls",
  displayName,
  exitHref,
  exitLabel = "Exit",
  onSkip,
  narration = false,
  reducedMotion,
  sigilSeed,
  showMotion = true,
  sound,
  toggleReducedMotion,
  toggleAmbience,
  toggleNarration,
  toggleSound,
}: {
  animationManaged?: boolean;
  ambience?: boolean;
  controlsLabel?: string;
  displayName?: string;
  exitHref: string;
  exitLabel?: string;
  onSkip?: () => void;
  narration?: boolean;
  reducedMotion: boolean;
  sigilSeed?: string;
  showMotion?: boolean;
  sound: boolean;
  toggleAmbience?: () => void;
  toggleNarration?: () => void;
  toggleReducedMotion?: () => void;
  toggleSound: () => void;
}) {
  const [audioOpen, setAudioOpen] = useState(false);
  const motionState = animationManaged ? "managed" : reducedMotion ? "on" : "off";
  const activeAudioLayers = [sound, ambience, narration].filter(Boolean).length;
  return (
    <header aria-label={controlsLabel} className="sanctuary-controls ritual-hud">
      <Link className="sanctuary-exit ritual-hud__exit" href={exitHref}>
        <span aria-hidden="true">←</span> {exitLabel}
      </Link>
      {displayName && (
        <span className="ritual-hud__reader">
          {sigilSeed ? (
            <PrivateSigil label="Private profile sigil" seed={sigilSeed} subtle />
          ) : (
            <i aria-hidden="true">✦</i>
          )}
          <span>For {displayName}</span>
        </span>
      )}
      <div className="sanctuary-control-group ritual-hud__actions">
        {showMotion && toggleReducedMotion && (
          <button
            aria-label={`Reduced motion ${motionState}`}
            aria-pressed={reducedMotion}
            className="ritual-hud__toggle"
            disabled={animationManaged}
            onClick={toggleReducedMotion}
            type="button"
          >
            <span aria-hidden="true" className="ritual-hud__glyph">
              ◌
            </span>
            <span className="ritual-hud__label">
              Motion <b>{motionState}</b>
            </span>
          </button>
        )}
        <div className="ritual-hud__audio">
          <button
            aria-expanded={audioOpen}
            aria-label={`Sound controls, ${activeAudioLayers} ${activeAudioLayers === 1 ? "layer" : "layers"} on`}
            aria-pressed={activeAudioLayers > 0}
            className="ritual-hud__toggle"
            onClick={() => setAudioOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true" className="ritual-hud__glyph">
              {activeAudioLayers > 0 ? "◖" : "◗"}
            </span>
            <span className="ritual-hud__label">
              Sound <b>{activeAudioLayers}/3</b>
            </span>
          </button>
          {audioOpen && (
            <div aria-label="Sound layers" className="ritual-audio-panel" role="group">
              <p>
                <strong>Sound layers</strong>
                <span>Each layer stays on this device.</span>
              </p>
              <button aria-pressed={sound} onClick={toggleSound} type="button">
                <span aria-hidden="true">◌</span>
                <span>
                  <strong>Card effects</strong>
                  <small>Shuffle, deal, and reveal cues</small>
                </span>
                <b>{sound ? "On" : "Off"}</b>
              </button>
              {toggleAmbience && (
                <button
                  aria-pressed={ambience}
                  onClick={() => {
                    if (!ambience) primeRitualAudio();
                    toggleAmbience();
                  }}
                  type="button"
                >
                  <span aria-hidden="true">≈</span>
                  <span>
                    <strong>Atmosphere</strong>
                    <small>A quiet phase-reactive room tone</small>
                  </span>
                  <b>{ambience ? "On" : "Off"}</b>
                </button>
              )}
              {toggleNarration && (
                <button aria-pressed={narration} onClick={toggleNarration} type="button">
                  <span aria-hidden="true">“</span>
                  <span>
                    <strong>Local voice</strong>
                    <small>Uses an on-device English voice only</small>
                  </span>
                  <b>{narration ? "On" : "Off"}</b>
                </button>
              )}
            </div>
          )}
        </div>
        {onSkip && (
          <button
            aria-label="Skip animation"
            className="ritual-hud__toggle ritual-hud__skip"
            onClick={onSkip}
            type="button"
          >
            <span aria-hidden="true" className="ritual-hud__glyph">
              ⇥
            </span>
            <span className="ritual-hud__label">Skip</span>
          </button>
        )}
      </div>
    </header>
  );
}
