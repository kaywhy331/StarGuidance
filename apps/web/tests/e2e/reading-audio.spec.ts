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

  let audioSectionRequests = 0;
  const audioBase64 = silentWaveBase64(0.35);
  await page.route(`**/api/readings/${finalized.readingId}/audio`, async (route) => {
    audioSectionRequests += 1;
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
          audio_duration: 0.35,
          segments: [
            { text: "Your", start: 0.01, end: 0.08 },
            { text: "answer", start: 0.08, end: 0.16 },
            { text: "is", start: 0.16, end: 0.23 },
            { text: "here", start: 0.23, end: 0.32 },
          ],
        },
      })}\n\n`,
    });
  });

  const openSectionReading = async () => {
    await page.goto(`/reading/${finalized.readingId}`);
    await expect(page.getByTestId("reading-active-passage")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("tarot-spread-stage")).toBeVisible();
    await expect(page.getByRole("button", { name: "Play audio reading" })).toBeVisible();
    return Number(
      await page.getByTestId("reading-journey").getAttribute("data-loaded-section-count"),
    );
  };

  const sectionCount = await openSectionReading();
  await page.getByRole("button", { name: "Play audio reading" }).click();
  const audioControl = page.getByTestId("reading-audio-trigger");
  await expectPlaybackStarted(page);
  await expect
    .poll(() => page.locator(".physical-card-figure.is-narration-active").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".guided-passage .oracle-word.is-visible").count())
    .toBeGreaterThan(0);
  await expect(audioControl).toHaveAttribute("data-state", "ended", { timeout: 20_000 });
  await expect(page.locator(".physical-card-figure.is-narration-active")).toHaveCount(0);
  expect(audioSectionRequests).toBe(sectionCount);

  await openSectionReading();
  await page.getByRole("button", { name: "Play audio reading" }).click();
  await expectPlaybackStarted(page);
  await expect(audioControl).toHaveAttribute("data-state", "ended", { timeout: 20_000 });
  expect(audioSectionRequests).toBe(sectionCount);
});
