# Artwork provenance

## Rights boundary

The visual revision does not contain, trace, embed, or derive pixels from the owner-provided mood references. No identifiable character, logo, supplied screenshot, commercial tarot deck image, or recognizable franchise composition is stored in this repository. The references were treated only as a high-level atmosphere brief.

The sanctuary backgrounds and shared card back were generated specifically for StarGuidance with the built-in OpenAI image-generation tool on 2026-07-22. They are proprietary project assets and are not offered as public-domain or open-source artwork. The 78 card faces are original deterministic SVG compositions authored in this repository from geometric primitives. No scraped image source is used.

Production distribution remains subject to the repository owner's final brand, art, and license approval. Generation records and hashes below must remain with the project.

## Versioned asset set

| Asset                           | Dimensions |   Bytes | SHA-256                                                            |
| ------------------------------- | ---------: | ------: | ------------------------------------------------------------------ |
| `cosmic-gothic-desktop-v1.avif` |   1672×941 |  60,086 | `1b472503c0fc90d3fc0cb0cb76b3346cce71352c787f79b61820ef51b2641d7f` |
| `cosmic-gothic-desktop-v1.webp` |   1672×941 | 155,088 | `756aa1073e55c72200f5fa587401f17ebcd7bbe0ca14256d312fee5ea77e58a7` |
| `cosmic-gothic-mobile-v1.avif`  |   941×1672 |  27,398 | `cd1c6ea96617f44b0e9e4dcfdd00b7f5d29475c5265ee51d363cfd09e559bb2f` |
| `cosmic-gothic-mobile-v1.webp`  |   941×1672 |  92,332 | `ee07a66b654d343310a53b3c1eeabe4400138ca1adb819d5363bc9c25ed6e5cb` |
| `celestial-gothic-back-v1.avif` |  1024×1536 | 220,358 | `16ecb5f1000dc79d28b240b2ca6874290d83ed28940fcc467d79ca4c832a182a` |
| `celestial-gothic-back-v1.webp` |  1024×1536 | 491,400 | `f7581240cb0685e49bab4da94d3e2fb81d4176c499793780480bec05d92e9f2e` |

AVIF is preferred and WebP is the compatibility fallback. Reduced-motion mode uses the same non-animated illustration with parallax, mist, particles, typing, and flip transitions disabled.

## Card-face provenance

`starguidance-celestial-gothic-v2` maps all 78 IDs to a unique cacheable SVG face rendered by `packages/tarot-content/src/artwork.ts`. Major Arcana use card-specific symbolic scenes. Minor Arcana combine rank/court compositions with suit-specific symbols and palettes. Each card carries:

- `artworkId`
- `frontAsset`
- WebP and AVIF back assets
- descriptive alt text
- artist credit
- license and source
- provenance statement
- focal point and crop intent
- artwork version

The discreet title is part of the illustration. Position, orientation label, and interpretation remain outside the physical card component.

## Generation prompts

The built-in image-generation path was used; no API key or fallback CLI model was used.

### Desktop sanctuary

> Create an entirely original immense dreamlike cosmic Gothic sanctuary suspended in a star-filled void for a full-screen 16:9 web background. Use monumental distant ritual architecture, abstract throne silhouette, pillars and pointed arches dissolving into clouds, subtle geometric sigils, distant planets, layered nebula mist, deep foreground fog, and moon-white/pale-gold volumetric light. Preserve calm central space for cards and a dark lower quarter for the oracle console. Palette: deep teal, cyan, emerald, indigo, charcoal, blackened blue, restrained antique gold. No people, characters, cards, UI, text, logo, watermark, identifiable setting, recognizable franchise design, or commercial tarot artwork.

### Mobile sanctuary

> Create an entirely original tall 9:16 cosmic Gothic sanctuary composition designed for mobile rather than cropped from desktop. Place distant ritual architecture and pale light in the upper third, retain a darker central tarot stage, and keep the lower 35 percent uncluttered for transcript and composer. Use deep teal, cyan, emerald, indigo, charcoal, antique gold, cloud vapor, cosmic dust, and weathered stone. No people, characters, cards, UI, text, logo, watermark, identifiable setting, recognizable franchise design, or commercial tarot artwork.

### Shared card back

> Create a straight-on 2:3 physical tarot card back, perfectly centered and vertically symmetrical, with an original celestial Gothic emblem, radiant abstract star, concentric ritual geometry, mirrored crescent forms, botanical filigree, deep teal/indigo paper, antique-gold linework, paper grain, and restrained foil effect. No text, letters, numbers, logo, watermark, people, recognizable deck design, commercial tarot artwork, mockup, hand, table, perspective, or external shadow.

## Performance envelope

- A browser downloads one sanctuary format/composition, not all four variants.
- Mobile sanctuary transfer is capped at 350 KB by Playwright; the authored AVIF is 27,398 bytes and WebP fallback is 92,332 bytes.
- The ritual renders nine lightweight shuffle shells rather than 78 card components.
- The scene uses CSS transforms and 14 restrained particles; there is no canvas, WebGL, or 3D engine.
- The card-face renderer is covered by size and uniqueness tests.

The representative Pixel 7 Playwright check confirms that the browser selects the mobile sanctuary composition, renders no canvas, and stays below the 350,000-byte atmospheric-image transfer budget. The preferred mobile AVIF is 27,398 bytes; its WebP compatibility fallback is 92,332 bytes.

## Deploy-preview evidence

The checked-in screenshots were captured on 2026-07-22 from [Netlify Deploy Preview #3](https://deploy-preview-3--starguidance.netlify.app/visual-preview) at UI head `3d930f8758797fc4f99f1c6f3b321b74d7605cb7`. The route is noindexed and uses synthetic cards and prose only.

- [Desktop Chromium sanctuary](screenshots/sanctuary-reading-desktop-chromium.png)
- [Pixel 7 Chromium sanctuary](screenshots/sanctuary-reading-mobile-chromium.png)
- Capture result: 2 passed in 6.1 seconds against the remote preview.
- Netlify adapter status: success; root and `/visual-preview` both returned HTTP 200 before capture.
