"use client";

export type RitualSound = "shuffle" | "gather" | "cut" | "deal" | "reveal" | "complete";

let sharedContext: AudioContext | undefined;

function contextForGesture(): AudioContext | undefined {
  if (typeof window === "undefined" || !("AudioContext" in window)) return undefined;
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new window.AudioContext();
  if (sharedContext.state === "suspended") void sharedContext.resume();
  return sharedContext;
}

function tone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.025, duration / 5));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function breath(context: AudioContext, start: number, duration: number, volume: number) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let seed = Math.floor(start * 1_000_000) || 17;
  for (let index = 0; index < channel.length; index += 1) {
    seed = (seed * 16_807) % 2_147_483_647;
    channel[index] = (seed / 2_147_483_647) * 2 - 1;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 840;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + duration * 0.18);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
}

/**
 * A small procedural sound palette. It keeps the experience self-contained,
 * low-volume, and state-specific without loading or tracking media assets.
 */
export function playRitualSound(sound: RitualSound, index = 0) {
  try {
    const context = contextForGesture();
    if (!context) return;
    const now = context.currentTime + 0.01;
    if (sound === "shuffle") {
      breath(context, now, 0.16, 0.018);
      tone(context, 174, now, 0.18, 0.008, "triangle");
      return;
    }
    if (sound === "gather") {
      tone(context, 174, now, 0.46, 0.018, "sine");
      tone(context, 261.63, now + 0.055, 0.42, 0.013, "triangle");
      breath(context, now, 0.25, 0.009);
      return;
    }
    if (sound === "cut") {
      tone(context, 130.81, now, 0.34, 0.025, "sine");
      tone(context, 196, now + 0.035, 0.28, 0.011, "triangle");
      breath(context, now, 0.11, 0.014);
      return;
    }
    if (sound === "deal") {
      const pitch = 220 + (index % 5) * 11;
      tone(context, pitch, now, 0.18, 0.012, "triangle");
      tone(context, pitch * 2, now + 0.025, 0.12, 0.004, "sine");
      return;
    }
    if (sound === "reveal") {
      const root = 392 + (index % 3) * 18;
      tone(context, root, now, 0.58, 0.022, "sine");
      tone(context, root * 1.5, now + 0.07, 0.7, 0.012, "triangle");
      tone(context, root * 2, now + 0.14, 0.48, 0.006, "sine");
      return;
    }
    tone(context, 261.63, now, 0.9, 0.016, "sine");
    tone(context, 329.63, now + 0.09, 0.85, 0.012, "sine");
    tone(context, 392, now + 0.18, 0.8, 0.009, "triangle");
  } catch {
    // Sound is an optional enhancement. Unsupported or blocked audio must
    // never interrupt the locked reading flow.
  }
}
