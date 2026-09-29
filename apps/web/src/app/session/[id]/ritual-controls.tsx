"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { requestJson } from "@/lib/client-request";
import { useMotionPreference } from "@/lib/motion-preference";

import { hardNavigate } from "./hard-navigate";

import { PrivateSigil } from "./private-sigil";
import { primeRitualAudio } from "./ritual-audio";

const MENU_LINKS = [
  { href: "/history", label: "History" },
  { href: "/profile", label: "Profile" },
  { href: "/people", label: "People" },
  { href: "/settings", label: "Settings" },
] as const;

/** A small account menu for the ritual screens, where the site navigation is
 * hidden so the scene can fill the viewport. */
function RitualMenu() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    setError(undefined);
    const result = await requestJson("/api/auth", { method: "DELETE" });
    if (!result.ok) {
      setSigningOut(false);
      setError(result.error);
      return;
    }
    hardNavigate("/");
  };

  return (
    <div className="ritual-hud__menu" ref={containerRef}>
      <button
        aria-controls="ritual-hud-menu"
        aria-expanded={open}
        className="ritual-hud__toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="ritual-hud__glyph">
          ☰
        </span>
        <span className="ritual-hud__label">Menu</span>
      </button>
      {open && (
        <nav aria-label="Account" className="ritual-menu-panel" id="ritual-hud-menu">
          {MENU_LINKS.map(({ href, label }) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
          <button disabled={signingOut} onClick={() => void signOut()} type="button">
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          {error && <p role="alert">{error}</p>}
        </nav>
      )}
    </div>
  );
}

export function RitualControls({
  animationManaged = false,
  ambience = false,
  controlsLabel = "Reading controls",
  displayName,
  exitHref,
  exitLabel = "Exit",
  exitHard = false,
  menu = false,
  onSkip,
  skipLabel = "Skip ahead",
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
  /** Leave with a full page load, so no in-progress ritual state survives. */
  exitHard?: boolean;
  /** Show the account menu (History, Profile, People, Settings, Sign out). */
  menu?: boolean;
  /** Fast-forwards the current animation for this visit only. */
  onSkip?: () => void;
  skipLabel?: string;
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
  const { systemReducedMotion } = useMotionPreference();
  const [audioOpen, setAudioOpen] = useState(false);
  const motionLabel = reducedMotion ? "Reduced" : "Full";
  const motionLocked = animationManaged || systemReducedMotion;
  const activeLayers = [
    sound ? "Effects" : "",
    toggleAmbience && ambience ? "Atmosphere" : "",
    toggleNarration && narration ? "Voice" : "",
  ].filter(Boolean);
  const soundLabel = activeLayers.length === 0 ? "Off" : activeLayers.join(" + ");
  const exitContent = (
    <>
      <span aria-hidden="true">←</span> {exitLabel}
    </>
  );
  return (
    <header aria-label={controlsLabel} className="sanctuary-controls ritual-hud">
      {exitHard ? (
        <a className="sanctuary-exit ritual-hud__exit" href={exitHref}>
          {exitContent}
        </a>
      ) : (
        <Link className="sanctuary-exit ritual-hud__exit" href={exitHref}>
          {exitContent}
        </Link>
      )}
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
        {onSkip && (
          <button className="ritual-hud__toggle ritual-hud__skip" onClick={onSkip} type="button">
            <span aria-hidden="true" className="ritual-hud__glyph">
              ⇥
            </span>
            <span className="ritual-hud__label">{skipLabel}</span>
          </button>
        )}
        {showMotion && toggleReducedMotion && (
          <button
            aria-pressed={reducedMotion}
            className="ritual-hud__toggle"
            disabled={motionLocked}
            onClick={toggleReducedMotion}
            title={
              systemReducedMotion
                ? "Reduced motion follows your device setting"
                : animationManaged
                  ? "Calm motion is on for everyone right now"
                  : undefined
            }
            type="button"
          >
            <span aria-hidden="true" className="ritual-hud__glyph">
              ◌
            </span>
            <span className="ritual-hud__label">
              Motion: <b>{motionLabel}</b>
            </span>
          </button>
        )}
        <div className="ritual-hud__audio">
          <button
            aria-expanded={audioOpen}
            aria-pressed={activeLayers.length > 0}
            className="ritual-hud__toggle"
            onClick={() => setAudioOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true" className="ritual-hud__glyph">
              {activeLayers.length > 0 ? "◖" : "◗"}
            </span>
            <span className="ritual-hud__label">
              Sound: <b>{soundLabel}</b>
            </span>
          </button>
          {audioOpen && (
            <div aria-label="Sound choices" className="ritual-audio-panel" role="group">
              <p>
                <strong>Sound</strong>
                <span>
                  {toggleNarration
                    ? "Effects and atmosphere play on this device. The voice reading reads only the passage you play."
                    : "Effects and atmosphere play on this device."}
                </span>
              </p>
              <button aria-pressed={sound} onClick={toggleSound} type="button">
                <span aria-hidden="true">◌</span>
                <span>
                  <strong>Card effects</strong>
                  <small>Shuffle, deal, and reveal sounds</small>
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
                    <small>A quiet room tone that follows the reading</small>
                  </span>
                  <b>{ambience ? "On" : "Off"}</b>
                </button>
              )}
              {toggleNarration && (
                <button aria-pressed={narration} onClick={toggleNarration} type="button">
                  <span aria-hidden="true">“</span>
                  <span>
                    <strong>Voice reading</strong>
                    <small>
                      Plays one passage at a time. Only the passage you play is sent to our voice
                      service.
                    </small>
                  </span>
                  <b>{narration ? "On" : "Off"}</b>
                </button>
              )}
            </div>
          )}
        </div>
        {menu && <RitualMenu />}
      </div>
    </header>
  );
}
