import { renderTarotFaceSvg, tarotCards } from "@starguidance/tarot-content";

export async function GET(_: Request, context: { params: Promise<{ asset: string }> }) {
  const asset = (await context.params).asset;
  const cardId = asset.endsWith(".svg") ? asset.slice(0, -4) : asset;
  const card = tarotCards.find(({ id }) => id === cardId);
  if (!card) return new Response("Not found", { status: 404 });
  return new Response(renderTarotFaceSvg(card), {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "image/svg+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
