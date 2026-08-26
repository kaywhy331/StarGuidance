import { expect, test } from "@playwright/test";

import {
  completeRevealViaApi,
  createAccountAndProfileViaApi,
  finalizeReadingViaApi,
  prepareReadingViaApi,
} from "./reading-helpers";

function silentWaveBase64(durationSeconds = 2.4) {
  const sampleRate = 8_000;
  const frames = Math.ceil(sampleRate * durationSeconds);
  const bytes = Buffer.alloc(44 + frames, 128);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + frames, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames, 40);
  return bytes.toString("base64");
}

async function expectPlaybackStarted(page: import("@playwright/test").Page) {
  const audioControl = page.getByTestId("reading-audio-trigger");
  await expect
    .poll(() => audioControl.getAttribute("data-state"), { timeout: 20_000 })
    .toMatch(/playing|error/);
  if ((await audioControl.getAttribute("data-state")) !== "error") return;
  const diagnostic = await page.evaluate(async () => {
    const audio = document.querySelector("audio");
    const source = audio?.src;
    let blob: Blob | undefined;
    let sourceFetchError: string | undefined;
    try {
      blob = source ? await fetch(source).then((response) => response.blob()) : undefined;
    } catch (error) {
      sourceFetchError = error instanceof Error ? error.message : String(error);
    }
    const cacheName = (await caches.keys()).find((name) => name.includes("reading-audio"));
    const cache = cacheName ? await caches.open(cacheName) : undefined;
    const cachedAudioRequest = (await cache?.keys())?.find(({ url }) => url.endsWith("/audio"));
    const cachedBlob = cachedAudioRequest
      ? await cache?.match(cachedAudioRequest).then((response) => response?.blob())
      : undefined;
    const signature = blob ? [...new Uint8Array(await blob.slice(0, 16).arrayBuffer())] : undefined;
    const cachedSignature = cachedBlob
      ? [...new Uint8Array(await cachedBlob.slice(0, 16).arrayBuffer())]
      : undefined;
    return {
      blobSize: blob?.size,
      blobType: blob?.type,
      cachedBlobSize: cachedBlob?.size,
      cachedBlobType: cachedBlob?.type,
      cachedSignature,
      currentSourceProtocol: audio?.currentSrc.split(":", 1)[0],
      mediaError: audio?.error
        ? { code: audio.error.code, message: audio.error.message }
        : undefined,
      signature,
      sourceFetchError,
      sourceLength: source?.length,
      sourceProtocol: source?.split(":", 1)[0],
    };
  });
  throw new Error(`Audio failed to start: ${JSON.stringify(diagnostic)}`);
}

test("explicit narration plays, reveals words, illuminates cards, and survives reload from cache", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Playback lifecycle is covered once.");
  test.setTimeout(150_000);
  await createAccountAndProfileViaApi(page);
  const ceremony = await prepareReadingViaApi(page, {
    question: "What grounded step can help this project move forward?",
    spreadId: "three-card",
    personalizationMode: "pure_tarot",
  });
  const finalized = await finalizeReadingViaApi(page, ceremony, 20);
  await completeRevealViaApi(page, finalized.readingId, 3, 20);
  await page.evaluate(() => localStorage.setItem("sg:reading:narration", "true"));

  let synthesisRequests = 0;
  const audioBase64 = silentWaveBase64();
  await page.route(`**/api/readings/${finalized.readingId}/audio`, async (route) => {
    synthesisRequests += 1;
    await route.fulfill({
      status: 200,
      headers: {
        "cache-control": "private, no-store, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
        "x-reading-audio-format": "audio/wav",
      },
      body: `data: ${JSON.stringify({
        audio_base64: audioBase64,
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: {
          audio_duration: 2.4,
          segments: [
            { text: "What", start: 0.1, end: 0.45 },
            { text: "the cards", start: 0.45, end: 1 },
            { text: "indicate", start: 1, end: 1.45 },
            { text: "now", start: 1.45, end: 2.2 },
          ],
        },
      })}\n\n`,
    });
  });

  const openGuidedReading = async () => {
    await page.goto(`/reading/${finalized.readingId}`);
    await expect(page.getByTestId("reading-complete-story")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("tarot-spread-stage")).toBeVisible();
    await page.getByRole("button", { name: "Guided" }).click();
    await expect(page.getByRole("button", { name: "Play this section" })).toBeVisible();
  };

  await openGuidedReading();
  await page.getByRole("button", { name: "Play this section" }).click();
  const audioControl = page.getByTestId("reading-audio-trigger");
  await expectPlaybackStarted(page);
  await expect(page.locator(".physical-card-figure.is-narration-active")).toHaveCount(3);
  await expect
    .poll(() => page.locator(".guided-passage .oracle-word.is-visible").count())
    .toBeGreaterThan(0);
  await expect(audioControl).toHaveAttribute("data-state", "ended", { timeout: 10_000 });
  await expect(page.locator(".physical-card-figure.is-narration-active")).toHaveCount(0);
  expect(synthesisRequests).toBe(1);

  await openGuidedReading();
  await page.getByRole("button", { name: "Play this section" }).click();
  await expectPlaybackStarted(page);
  await expect(audioControl).toHaveAttribute("data-state", "ended", { timeout: 10_000 });
  expect(synthesisRequests).toBe(1);
});
