import { PersistedResultStreamAdapter } from "@starguidance/ai";
import { oracleStreamEventSchema, readingResultSchema } from "@starguidance/contracts";
import { requireUser } from "@/lib/auth";
import { localStore } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const reading = localStore.readings.get((await context.params).id);
    if (!reading || reading.userId !== user.id)
      return Response.json({ error: "Reading not found." }, { status: 404 });

    const target = new URL(request.url).searchParams.get("target") ?? "primary";
    const result =
      target === "primary"
        ? reading.result
        : reading.followUps.find(({ id }) => id === target)?.result;
    if (!result)
      return Response.json(
        { error: "The persisted interpretation is not ready." },
        { status: 409 },
      );

    const validated = readingResultSchema.parse(result);
    const encoder = new TextEncoder();
    const adapter = new PersistedResultStreamAdapter();
    const requestedFailure = Number(request.headers.get("x-e2e-stream-fail-after") ?? "0");
    const failAfter = process.env.APP_ENV === "test" ? requestedFailure : 0;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let phaseCount = 0;
        try {
          for await (const event of adapter.streamPersistedResult(validated)) {
            if (event.type === "phase") {
              phaseCount += 1;
              if (failAfter > 0 && phaseCount > failAfter)
                throw new Error("TEST_STREAM_INTERRUPTION");
            }
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            if (event.type === "phase") await new Promise((resolve) => setTimeout(resolve, 55));
          }
        } catch {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify(
                oracleStreamEventSchema.parse({
                  type: "error",
                  message: "The oracle stream paused. Received text remains available.",
                }),
              )}\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "cache-control": "no-store, no-transform",
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
}
