import type { Suit, TarotCard } from "@starguidance/tarot-domain";

const suitColors: Record<Suit, { light: string; mid: string; dark: string }> = {
  wands: { light: "#f5c878", mid: "#a64f32", dark: "#241018" },
  cups: { light: "#a8eef0", mid: "#287a83", dark: "#071c2a" },
  swords: { light: "#e6edf0", mid: "#5d7186", dark: "#101623" },
  pentacles: { light: "#d9d68a", mid: "#4b8268", dark: "#101d19" },
};

const pipPositions = [
  [360, 420],
  [250, 340],
  [470, 340],
  [240, 500],
  [480, 500],
  [230, 655],
  [490, 655],
  [300, 760],
  [420, 760],
  [360, 610],
] as const;

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function hash(value: string): number {
  return [...value].reduce(
    (result, character) => (result * 33 + character.charCodeAt(0)) >>> 0,
    5381,
  );
}

function stars(seed: string): string {
  let value = hash(seed);
  return Array.from({ length: 34 }, (_, index) => {
    value = (value * 1664525 + 1013904223) >>> 0;
    const x = 62 + (value % 596);
    value = (value * 1664525 + 1013904223) >>> 0;
    const y = 72 + (value % 820);
    const radius = index % 9 === 0 ? 2.4 : 1.1;
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#f4dfac" opacity="${index % 3 === 0 ? 0.8 : 0.42}"/>`;
  }).join("");
}

function suitGlyph(suit: Suit, x: number, y: number, scale = 1): string {
  const transform = `translate(${x} ${y}) scale(${scale})`;
  if (suit === "wands")
    return `<g transform="${transform}"><path d="M-9 52 8-55" stroke="currentColor" stroke-width="10" stroke-linecap="round"/><path d="m2-25 28-18M-1-4l-28-20M-5 24l25-14" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></g>`;
  if (suit === "cups")
    return `<g transform="${transform}"><path d="M-42-48h84v18c0 38-18 58-42 58s-42-20-42-58Z" fill="none" stroke="currentColor" stroke-width="8"/><path d="M0 28v34M-30 64h60" stroke="currentColor" stroke-width="8" stroke-linecap="round"/></g>`;
  if (suit === "swords")
    return `<g transform="${transform}"><path d="M0-64 13-42 6 35H-6l-7-77Z" fill="none" stroke="currentColor" stroke-width="7"/><path d="M-34 35h68M0 35v32" stroke="currentColor" stroke-width="8" stroke-linecap="round"/></g>`;
  return `<g transform="${transform}"><circle r="53" fill="none" stroke="currentColor" stroke-width="7"/><path d="m0-40 10 29 31 1-25 18 9 30L0 20l-25 18 9-30-25-18 31-1Z" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/></g>`;
}

function majorScene(index: number): string {
  const scenes = [
    `<path d="M130 760q210-220 455-390" fill="none" stroke="currentColor" stroke-width="13"/><circle cx="560" cy="300" r="58" fill="none" stroke="currentColor" stroke-width="8"/><path d="m150 704 42-92 52 78Z" fill="currentColor" opacity=".48"/>`,
    `<path d="M250 330c65-78 155-78 220 0-65 78-155 78-220 0Z" fill="none" stroke="currentColor" stroke-width="9"/><path d="M190 730h340M250 620h220M360 430v300" stroke="currentColor" stroke-width="9"/><circle cx="360" cy="525" r="70" fill="none" stroke="currentColor" stroke-width="7"/>`,
    `<path d="M185 770V315h100v455M435 770V315h100v455" fill="none" stroke="currentColor" stroke-width="12"/><path d="M240 310q120-180 240 0" fill="none" stroke="currentColor" stroke-width="9"/><path d="M330 430q120 80 0 160 100 75 5 150" fill="none" stroke="currentColor" stroke-width="8"/>`,
    `<path d="M360 760V410" stroke="currentColor" stroke-width="12"/><path d="M360 515c-110-160-235-65-140 50 48 55 100 60 140 45M360 515c110-160 235-65 140 50-48 55-100 60-140 45" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="360" cy="340" r="80" fill="none" stroke="currentColor" stroke-width="8"/>`,
    `<path d="m180 760 180-430 180 430Z" fill="none" stroke="currentColor" stroke-width="12"/><path d="m290 425 70-120 70 120M270 640h180" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="360" cy="530" r="55" fill="none" stroke="currentColor" stroke-width="8"/>`,
    `<path d="M185 760V350q175-155 350 0v410M250 760V440q110-100 220 0v320" fill="none" stroke="currentColor" stroke-width="10"/><path d="m315 665 90-155M405 665l-90-155" stroke="currentColor" stroke-width="12"/>`,
    `<circle cx="285" cy="455" r="75" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="435" cy="455" r="75" fill="none" stroke="currentColor" stroke-width="9"/><path d="M285 530q75 150 150 0M360 365v-95M325 300h70" fill="none" stroke="currentColor" stroke-width="9"/>`,
    `<circle cx="250" cy="680" r="70" fill="none" stroke="currentColor" stroke-width="12"/><circle cx="470" cy="680" r="70" fill="none" stroke="currentColor" stroke-width="12"/><path d="M190 620 260 350h200l70 270M260 350l100-95 100 95" fill="none" stroke="currentColor" stroke-width="10"/>`,
    `<path d="M240 760q0-300 120-440 120 140 120 440" fill="none" stroke="currentColor" stroke-width="12"/><path d="M300 535q60-80 120 0-60 85-120 0Z" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="360" cy="535" r="17" fill="currentColor"/>`,
    `<path d="M200 770 360 300l160 470" fill="none" stroke="currentColor" stroke-width="12"/><path d="M265 605q95-130 190 0" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="360" cy="430" r="42" fill="none" stroke="currentColor" stroke-width="8"/>`,
    `<circle cx="360" cy="530" r="190" fill="none" stroke="currentColor" stroke-width="13"/><circle cx="360" cy="530" r="95" fill="none" stroke="currentColor" stroke-width="8"/><path d="M360 300v460M130 530h460M225 395l270 270M495 395 225 665" stroke="currentColor" stroke-width="6"/>`,
    `<path d="M190 420h340M240 420l120-145 120 145M270 420l-70 310M450 420l70 310M200 730h320" fill="none" stroke="currentColor" stroke-width="11"/><circle cx="360" cy="535" r="72" fill="none" stroke="currentColor" stroke-width="8"/>`,
    `<path d="M360 290v440M255 365h210M280 730h160" stroke="currentColor" stroke-width="13"/><circle cx="360" cy="555" r="110" fill="none" stroke="currentColor" stroke-width="8"/><path d="M360 445q-100 110 0 220 100-110 0-220Z" fill="currentColor" opacity=".3"/>`,
    `<path d="M165 700q195-75 390 0M195 640q165-300 330 0" fill="none" stroke="currentColor" stroke-width="12"/><path d="M360 315v355M310 395h100" stroke="currentColor" stroke-width="9"/><circle cx="360" cy="285" r="42" fill="currentColor" opacity=".55"/>`,
    `<path d="M220 380q140 90 280 0M220 680q140-90 280 0M250 380v300M470 380v300" fill="none" stroke="currentColor" stroke-width="11"/><path d="M300 520q60-105 120 0-60 105-120 0Z" fill="none" stroke="currentColor" stroke-width="8"/>`,
    `<path d="M220 700q140-380 280 0M270 700q90-220 180 0" fill="none" stroke="currentColor" stroke-width="12"/><circle cx="360" cy="370" r="95" fill="none" stroke="currentColor" stroke-width="9"/><path d="m305 340 110 60M415 340l-110 60" stroke="currentColor" stroke-width="8"/>`,
    `<path d="M235 760 290 300l70 165 70-165 55 460" fill="none" stroke="currentColor" stroke-width="13"/><path d="m280 520 80-55 80 55-80 85Z" fill="currentColor" opacity=".34"/>`,
    `<path d="M360 270 390 390l120-30-95 80 80 100-120-40-15 125-15-125-120 40 80-100-95-80 120 30Z" fill="none" stroke="currentColor" stroke-width="10"/><path d="M190 750q170-150 340 0" fill="none" stroke="currentColor" stroke-width="11"/>`,
    `<circle cx="360" cy="390" r="120" fill="none" stroke="currentColor" stroke-width="10"/><path d="M360 270a120 120 0 0 0 0 240 90 90 0 0 1 0-240Z" fill="currentColor" opacity=".36"/><path d="M195 750q165-220 330 0" fill="none" stroke="currentColor" stroke-width="11"/>`,
    `<circle cx="360" cy="385" r="125" fill="currentColor" opacity=".28"/><path d="M360 220v330M195 385h330M245 270l230 230M475 270 245 500" stroke="currentColor" stroke-width="9"/><path d="M200 750q160-165 320 0" fill="none" stroke="currentColor" stroke-width="11"/>`,
    `<path d="M190 700q170-210 340 0M250 630q110-360 220 0" fill="none" stroke="currentColor" stroke-width="12"/><path d="M250 350h220M285 300h150" stroke="currentColor" stroke-width="9"/><circle cx="360" cy="465" r="55" fill="none" stroke="currentColor" stroke-width="8"/>`,
    `<circle cx="360" cy="520" r="210" fill="none" stroke="currentColor" stroke-width="13"/><path d="M360 310q130 80 0 210-130-130 0-210Zm0 210q130 130 0 210-130-80 0-210Z" fill="currentColor" opacity=".3"/><circle cx="360" cy="520" r="75" fill="none" stroke="currentColor" stroke-width="8"/>`,
  ];
  return scenes[index] ?? scenes[0] ?? "";
}

function minorScene(card: TarotCard): string {
  const suit = card.suit as Suit;
  const rankIndex = [
    "Ace",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Page",
    "Knight",
    "Queen",
    "King",
  ].indexOf(card.rank);
  if (rankIndex >= 10) {
    const crown =
      rankIndex === 10
        ? "M300 390h120"
        : rankIndex === 11
          ? "M260 400h200"
          : rankIndex === 12
            ? "m280 400 80-95 80 95"
            : "m270 400 45-100 45 75 45-75 45 100";
    const mount =
      rankIndex === 11
        ? `<path d="M225 690q135-180 270 0l-55 70H280Z" fill="currentColor" opacity=".24"/>`
        : "";
    return `${mount}<path d="${crown}" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><circle cx="360" cy="485" r="78" fill="none" stroke="currentColor" stroke-width="9"/><path d="M245 760q20-195 115-195t115 195" fill="none" stroke="currentColor" stroke-width="11"/>${suitGlyph(suit, 360, 665, 0.72)}`;
  }
  const count = rankIndex + 1;
  return pipPositions
    .slice(0, count)
    .map(([x, y], index) =>
      suitGlyph(
        suit,
        x,
        y,
        count === 1 ? 1.55 : index === count - 1 && count % 2 === 1 ? 0.75 : 0.58,
      ),
    )
    .join("");
}

export function renderTarotFaceSvg(card: TarotCard): string {
  const majorIndex = card.arcana === "major" ? Number(card.rank) : 0;
  const palette = card.suit
    ? suitColors[card.suit]
    : {
        light: majorIndex % 2 === 0 ? "#f1d690" : "#b8f0e3",
        mid: majorIndex % 3 === 0 ? "#326f73" : "#63538a",
        dark: "#090d1a",
      };
  const illustration = card.arcana === "major" ? majorScene(majorIndex) : minorScene(card);
  const numeral = card.arcana === "major" ? String(majorIndex).padStart(2, "0") : card.rank;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1080" role="img" aria-label="${escapeXml(card.artwork.altText)}">
  <defs>
    <radialGradient id="sky" cx="50%" cy="34%" r="78%"><stop offset="0" stop-color="${palette.mid}"/><stop offset=".48" stop-color="${palette.dark}"/><stop offset="1" stop-color="#03060c"/></radialGradient>
    <linearGradient id="gilt" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff2bb"/><stop offset=".45" stop-color="${palette.light}"/><stop offset="1" stop-color="#9a6732"/></linearGradient>
    <filter id="paper"><feTurbulence baseFrequency=".65" numOctaves="3" seed="${majorIndex + card.name.length}" type="fractalNoise"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .11 0"/></filter>
    <filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="720" height="1080" fill="#04070d"/>
  <rect x="22" y="22" width="676" height="1036" rx="12" fill="url(#sky)" stroke="url(#gilt)" stroke-width="10"/>
  <path d="M58 890q145-150 302-20 157-130 302 20v128H58Z" fill="#02060a" opacity=".82"/>
  <g opacity=".75">${stars(card.id)}</g>
  <circle cx="360" cy="485" r="245" fill="none" stroke="${palette.light}" stroke-opacity=".18" stroke-width="2"/>
  <circle cx="360" cy="485" r="210" fill="none" stroke="${palette.light}" stroke-opacity=".14" stroke-width="1"/>
  <path d="M72 208Q360 60 648 208M72 854Q360 998 648 854" fill="none" stroke="${palette.light}" stroke-opacity=".35" stroke-width="3"/>
  <g color="${palette.light}" filter="url(#glow)" stroke-linecap="round" stroke-linejoin="round">${illustration}</g>
  <rect x="22" y="22" width="676" height="1036" rx="12" filter="url(#paper)" opacity=".34"/>
  <rect x="44" y="44" width="632" height="992" rx="8" fill="none" stroke="${palette.light}" stroke-opacity=".65" stroke-width="2"/>
  <text x="360" y="103" fill="${palette.light}" font-family="Georgia,serif" font-size="24" letter-spacing="7" text-anchor="middle">${escapeXml(numeral.toUpperCase())}</text>
  <text x="360" y="995" fill="#f4ead1" font-family="Georgia,serif" font-size="30" letter-spacing="2" text-anchor="middle">${escapeXml(card.name.toUpperCase())}</text>
  <path d="M250 948h220" stroke="url(#gilt)" stroke-width="2"/>
  </svg>`;
}

function constellation(seed: string): string {
  let value = hash(`constellation:${seed}`);
  const points = Array.from({ length: 7 }, (_, index) => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    const x = 105 + (value % 510);
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    const y = 145 + (value % 225) + index * 3;
    return [x, y] as const;
  });
  const path = points.map(([x, y]) => `${x},${y}`).join(" ");
  const nodes = points
    .map(
      ([x, y], index) =>
        `<circle cx="${x}" cy="${y}" r="${index % 3 === 0 ? 4.2 : 2.2}" fill="currentColor" opacity="${index % 2 === 0 ? 0.8 : 0.48}"/>`,
    )
    .join("");
  return `<polyline points="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-opacity=".32"/>${nodes}`;
}

function narrativeLandscape(card: TarotCard): string {
  const value = hash(`landscape:${card.id}`);
  const horizon = 720 + (value % 86);
  const offset = (value % 91) - 45;
  const scenes = [
    `<path d="M45 ${horizon} 170 ${horizon - 185} 255 ${horizon - 72} 360 ${horizon - 250} 470 ${horizon - 92} 675 ${horizon - 210}V930H45Z" fill="currentColor" opacity=".12"/><path d="M45 ${horizon} 170 ${horizon - 185} 255 ${horizon - 72} 360 ${horizon - 250} 470 ${horizon - 92} 675 ${horizon - 210}" fill="none" stroke="currentColor" stroke-width="3" stroke-opacity=".34"/>`,
    `<path d="M45 ${horizon}q115-78 230 0t230 0 170 0v210H45Z" fill="currentColor" opacity=".1"/><path d="M45 ${horizon}q115-78 230 0t230 0 170 0M45 ${horizon + 58}q115-65 230 0t230 0 170 0" fill="none" stroke="currentColor" stroke-width="3" stroke-opacity=".32"/>`,
    `<path d="M125 900V${horizon - 170}q235-245 470 0V900M200 900V${horizon - 115}q160-160 320 0V900" fill="none" stroke="currentColor" stroke-width="6" stroke-opacity=".28"/><path d="M270 900V${horizon - 50}q90-90 180 0V900" fill="currentColor" opacity=".08"/>`,
    `<path d="M60 900 140 ${horizon - 180}l62 180 80 ${horizon - 255} 78 255 92 ${horizon - 215} 72 215 70 ${horizon - 155} 70 155Z" fill="currentColor" opacity=".1"/><path d="M60 900 140 ${horizon - 180}l62 180 80 ${horizon - 255} 78 255 92 ${horizon - 215} 72 215 70 ${horizon - 155} 70 155" fill="none" stroke="currentColor" stroke-width="3" stroke-opacity=".28"/>`,
    `<path d="M70 900V${horizon - 25}h95v-110h80v65h75v-190h96v125h72v-80h88v190M45 ${horizon + 30}h630" fill="none" stroke="currentColor" stroke-width="5" stroke-opacity=".28"/><path d="M115 ${horizon - 70}h18m70-80h18m140-45h22m65 95h18" stroke="currentColor" stroke-width="8" stroke-opacity=".38"/>`,
    `<path d="M45 900q160-260 315-65 155-195 315 65M${130 + offset} 900q${210 - offset}-335 ${430 - offset} 0" fill="none" stroke="currentColor" stroke-width="5" stroke-opacity=".3"/><circle cx="${360 + offset}" cy="${horizon - 170}" r="78" fill="currentColor" opacity=".08"/>`,
  ];
  return scenes[value % scenes.length] ?? scenes[0] ?? "";
}

/**
 * Version 3 adds a unique constellation, horizon, light source, and spatial
 * frame to every existing symbolic composition. V2 remains exported for
 * immutable historical URLs; new draws opt into this renderer explicitly.
 */
export function renderTarotFaceSvgV3(card: TarotCard): string {
  const seed = hash(`v3:${card.id}`);
  const majorIndex = card.arcana === "major" ? Number(card.rank) : 0;
  const palette = card.suit
    ? suitColors[card.suit]
    : {
        light: majorIndex % 2 === 0 ? "#f1d690" : "#b8f0e3",
        mid: majorIndex % 3 === 0 ? "#326f73" : "#63538a",
        dark: "#090d1a",
      };
  const illustration = card.arcana === "major" ? majorScene(majorIndex) : minorScene(card);
  const numeral = card.arcana === "major" ? String(majorIndex).padStart(2, "0") : card.rank;
  const orbX = 190 + (seed % 340);
  const orbY = 225 + ((seed >>> 8) % 235);
  const orbRadius = 46 + ((seed >>> 16) % 58);
  const landscape = narrativeLandscape(card);
  const constellationMap = constellation(card.id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1080" role="img" aria-label="${escapeXml(card.artwork.altText)}">
  <defs>
    <radialGradient id="sky-v3" cx="${Math.round((orbX / 720) * 100)}%" cy="${Math.round((orbY / 1080) * 100)}%" r="88%"><stop offset="0" stop-color="${palette.mid}"/><stop offset=".38" stop-color="${palette.dark}"/><stop offset="1" stop-color="#020409"/></radialGradient>
    <radialGradient id="orb-v3"><stop stop-color="#fff6d3" stop-opacity=".85"/><stop offset=".28" stop-color="${palette.light}" stop-opacity=".36"/><stop offset="1" stop-color="${palette.light}" stop-opacity="0"/></radialGradient>
    <linearGradient id="gilt-v3" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff4c6"/><stop offset=".46" stop-color="${palette.light}"/><stop offset="1" stop-color="#8b5c2e"/></linearGradient>
    <filter id="paper-v3"><feTurbulence baseFrequency=".52" numOctaves="4" seed="${seed % 97}" type="fractalNoise"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .12 0"/></filter>
    <filter id="glow-v3"><feGaussianBlur stdDeviation="4.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="frame-v3"><rect x="44" y="44" width="632" height="992" rx="16"/></clipPath>
  </defs>
  <rect width="720" height="1080" fill="#020409"/>
  <rect x="20" y="20" width="680" height="1040" rx="18" fill="url(#sky-v3)" stroke="url(#gilt-v3)" stroke-width="10"/>
  <g clip-path="url(#frame-v3)">
    <circle cx="${orbX}" cy="${orbY}" r="${orbRadius * 2.5}" fill="url(#orb-v3)"/>
    <circle cx="${orbX}" cy="${orbY}" r="${orbRadius}" fill="none" stroke="${palette.light}" stroke-width="3" stroke-opacity=".58"/>
    <g color="${palette.light}" opacity=".66">${stars(`v3:${card.id}`)}</g>
    <g color="${palette.light}" opacity=".72">${constellationMap}</g>
    <g color="${palette.light}">${landscape}</g>
    <path d="M45 890q145-125 315-34 170-91 315 34v146H45Z" fill="#020409" opacity=".76"/>
    <circle cx="360" cy="500" r="258" fill="none" stroke="${palette.light}" stroke-width="2" stroke-opacity=".14"/>
    <circle cx="360" cy="500" r="216" fill="none" stroke="${palette.light}" stroke-width="1" stroke-dasharray="3 12" stroke-opacity=".24"/>
    <g color="${palette.light}" filter="url(#glow-v3)" stroke-linecap="round" stroke-linejoin="round">${illustration}</g>
    <rect x="20" y="20" width="680" height="1040" filter="url(#paper-v3)" opacity=".3"/>
  </g>
  <rect x="44" y="44" width="632" height="992" rx="16" fill="none" stroke="${palette.light}" stroke-width="2" stroke-opacity=".62"/>
  <path d="M44 172h70l35-35m422 0 35 35h70M44 908h70l35 35m422 0 35-35h70" fill="none" stroke="url(#gilt-v3)" stroke-width="3" stroke-opacity=".72"/>
  <path d="M275 115h170M275 943h170" stroke="url(#gilt-v3)" stroke-width="2"/>
  <text x="360" y="99" fill="${palette.light}" font-family="Georgia,serif" font-size="23" letter-spacing="8" text-anchor="middle">${escapeXml(numeral.toUpperCase())}</text>
  <text x="360" y="995" fill="#f7edd8" font-family="Georgia,serif" font-size="28" letter-spacing="1.5" text-anchor="middle">${escapeXml(card.name.toUpperCase())}</text>
  <circle cx="74" cy="74" r="6" fill="${palette.light}" opacity=".7"/><circle cx="646" cy="74" r="6" fill="${palette.light}" opacity=".7"/><circle cx="74" cy="1006" r="6" fill="${palette.light}" opacity=".7"/><circle cx="646" cy="1006" r="6" fill="${palette.light}" opacity=".7"/>
  </svg>`;
}
