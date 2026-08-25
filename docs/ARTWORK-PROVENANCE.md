# Artwork provenance

## Rights boundary

The visual revision does not contain, trace, embed, or derive pixels from the owner-provided mood references. No identifiable character, logo, supplied screenshot, commercial tarot deck image, or recognizable franchise composition is stored in this repository. The references were treated only as a high-level atmosphere brief.

The sanctuary backgrounds and shared card back were generated specifically for StarGuidance with the built-in OpenAI image-generation tool on 2026-07-22. The focused-reading starry-night backgrounds were generated with the same tool on 2026-08-25. They are proprietary project assets and are not offered as public-domain or open-source artwork. The 78 card faces are original deterministic SVG compositions authored in this repository from geometric primitives. No scraped image source is used.

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
| `starry-night-desktop-v1.avif`  |  1536×1024 |  61,394 | `31fa3210ddf61ed023bfd96170a8d3e379ed0da96164941c892928b03d02d962` |
| `starry-night-desktop-v1.webp`  |  1536×1024 |  97,384 | `0a0b9479ceca5c2495e45eb2663c4b9b4529ba2c3d63a1d8da2d34461f7a954c` |
| `starry-night-mobile-v1.avif`   |   941×1672 |  59,786 | `bd6830957ef952d434c48af9b0d4907f070a8f2942cf04a66eef01be5f3c34b8` |
| `starry-night-mobile-v1.webp`   |   941×1672 |  91,826 | `78295376168e68db9779287a865ecd2d798221bea739ca0e609503e463821347` |

AVIF is preferred and WebP is the compatibility fallback. Reduced-motion mode uses the same non-animated illustration with parallax, mist, particles, typing, and flip transitions disabled.

## Card-face provenance

`starguidance-celestial-gothic-v3` maps all 78 IDs to a unique cacheable SVG face rendered by `packages/tarot-content/src/artwork.ts`. It extends the preserved v2 renderer with a card-specific constellation, horizon/landscape, luminous orb, and spatial frame while retaining original geometric authorship. Major Arcana use card-specific symbolic scenes. Minor Arcana combine rank/court compositions with suit-specific symbols and palettes. The `/art/tarot/v2/…` route and renderer remain unchanged so a historical deck reference stays readable; new draws resolve `/art/tarot/v3/…`. Each card carries:

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

### Focused-reading starry night — desktop

> Create an entirely original clear starry-night fantasy backdrop for StarGuidance card-reading scenes. Elegant stylized realism with Japanese anime fantasy light-novel key-art atmosphere, Gothic occult architecture, celestial surrealism, painterly rendering, dramatic cool rim lighting, and restrained ethereal fog. Use a muted black and deep midnight-blue palette with slight dark-purple shadows and small luminous cyan, moon-white, and antique-gold accents. Preserve a broad, dark, uncluttered central sky as negative space for tarot cards; keep distant Gothic silhouettes and symbolic constellation geometry at the perimeter and low horizon. Highly detailed but calm. No people, characters, cards, UI, text, logo, watermark, recognizable franchise design, or commercial tarot artwork.

### Focused-reading starry night — mobile

> Recompose the supplied original StarGuidance starry-night backdrop as a purpose-built tall mobile scene rather than a simple crop. Preserve the same painterly clear night, muted black/deep-blue/slight-purple palette, luminous stars, Gothic occult silhouettes, celestial geometry, rim light, and light fog. Keep the central vertical field dark and open for tarot cards, with details concentrated at the upper sky, side edges, and low horizon. No people, characters, cards, UI, text, logo, watermark, recognizable franchise design, or commercial tarot artwork.

The portrait composition used the generated desktop artwork as its only visual reference so both responsive variants remain one original, coherent environment.

## Performance envelope

- A browser downloads one background format/composition for the active scene, not every responsive or compatibility variant.
- Every focused-reading background is below 100 KB. The mobile AVIF is 59,786 bytes and its WebP fallback is 91,826 bytes.
- Mobile atmospheric-image transfer remains capped at 350 KB by Playwright; both sanctuary and focused-reading compositions remain comfortably inside that budget.
- The ritual renders 78 lightweight anonymous card-back shells in six streams, rather than mounting 78 artwork-bearing card components.
- The scene uses CSS transforms and 14 restrained particles; there is no canvas, WebGL, or 3D engine.
- The card-face renderer is covered by size and uniqueness tests.

The representative Pixel 7 Playwright check confirms that the browser selects the appropriate mobile composition, renders no canvas, and stays below the 350,000-byte atmospheric-image transfer budget. The focused-reading picture uses its portrait source only during shuffle, cut, deal, reveal, interpretation, and next-action scenes; onboarding and other ambient surfaces retain the original sanctuary art.

## Typography provenance

The product bundles `@fontsource-variable/cormorant@5.3.0` and `@fontsource-variable/manrope@5.3.0`. Both packages declare the SIL Open Font License 1.1 and include their license text in the installed package. The WOFF2 files are built with the application; StarGuidance does not call a hosted font service at runtime. Cormorant is used for editorial display and long-form reflective reading, while Manrope carries controls, labels, provenance, and accessibility-oriented utility copy.

## Deploy-preview evidence

The checked-in screenshots were captured on 2026-08-20 from [Netlify Deploy Preview #19](https://deploy-preview-19--starguidance.netlify.app/visual-preview) at UI head `22ec54d5610a65f3801f3055467cb2e8be07c27c`. The route is noindexed and uses synthetic cards and prose only.

- [Desktop Chromium sanctuary](screenshots/sanctuary-reading-desktop-chromium.png)
- [Pixel 7 Chromium sanctuary](screenshots/sanctuary-reading-mobile-chromium.png)
- Capture result: 2 passed in 6.1 seconds against the remote preview.
- Netlify adapter status: success; root and `/visual-preview` both returned HTTP 200 before capture.
