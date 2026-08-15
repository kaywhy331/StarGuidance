import { PersistedResultStreamAdapter } from "@starguidance/ai";
import {
  followUpResultSchema,
  oracleStreamEventSchema,
  readingResultSchema,
} from "@starguidance/contracts";
import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const persistence = persistenceFor(user);
    const reading = await persistence.repositories.readingSessions.get(
      user.id,
      (await context.params).id,
    );
    if (!reading) return Response.json({ error: "Reading not found." }, { status: 404 });

    const target = new URL(request.url).searchParams.get("target") ?? "primary";
    const primary = target === "primary";
    const result = primary
      ? reading.result
      : reading.followUps.find(({ id }) => id === target)?.result;
    if (!result)
      return Response.json(
        { error: "The persisted interpretation is not ready." },
        { status: 409 },
      );

    const encoder = new TextEncoder();
    const adapter = new PersistedResultStreamAdapter();
    const requestedFailure = Number(request.headers.get("x-e2e-stream-fail-after") ?? "0");
    const failAfter = process.env.APP_ENV === "test" ? requestedFailure : 0;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let phaseCount = 0;
        try {
          const events = primary
            ? adapter.streamPersistedResult(readingResultSchema.parse(result))
            : adapter.streamPersistedFollowUp(followUpResultSchema.parse(result));
          for await (const event of events) {
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
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return Response.json({ error: "Authentication required." }, { status: 401 });
    return Response.json(
      { error: "The persisted interpretation could not be loaded." },
      { status: 500 },
    );
  }
}
