import http from "node:http";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_ALLOWED_MODELS,
  DEFAULT_REQUEST_BYTES,
  DEFAULT_RESPONSE_BYTES,
  FixedWindowBudgetLimiter,
  FixedWindowRateLimiter,
  canonicalCompletionResponse,
  canonicalInferencePayload,
  conservativeTokenBudget,
  constantTimeEquals,
  isLoopback,
  readBoundedBody,
  readBoundedWebResponse,
  readRequiredSecret,
  requestId,
  sendError,
  sendJson,
} from "./security.mjs";

const INGRESS_PATH = "/openai/v1/chat/completions";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export function createEgressServer({
  fetchImpl = fetch,
  allowedModels = DEFAULT_ALLOWED_MODELS,
  maxRequestBytes = DEFAULT_REQUEST_BYTES,
  maxResponseBytes = DEFAULT_RESPONSE_BYTES,
  timeoutMs = 45_000,
  bodyTimeoutMs = 10_000,
  rateLimit = 30,
  rateWindowMs = 60_000,
  maxConcurrency = 4,
  limiter = new FixedWindowRateLimiter(rateLimit, rateWindowMs),
  tokenBudgetLimiter = new FixedWindowBudgetLimiter(),
  groqEndpoint = GROQ_ENDPOINT,
  groqApiKey,
  tokenpakEgressToken,
} = {}) {
  if (typeof groqApiKey !== "string" || groqApiKey.length < 32 || new Set(groqApiKey).size < 8)
    throw new Error("GROQ_API_KEY_WEAK");
  if (
    typeof tokenpakEgressToken !== "string" ||
    tokenpakEgressToken.length < 32 ||
    new Set(tokenpakEgressToken).size < 8
  )
    throw new Error("TOKENPAK_EGRESS_TOKEN_WEAK");
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32)
    throw new Error("MAX_CONCURRENCY_INVALID");
  let inFlight = 0;
  const server = http.createServer(async (req, res) => {
    const identifier = requestId(req.headers["x-request-id"]);
    if (req.method === "GET" && req.url === "/healthz" && isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 200, { status: "ok" }, { "x-request-id": identifier });
      return;
    }
    if (req.method !== "POST" || req.url !== INGRESS_PATH) {
      sendError(res, 404, "ROUTE_NOT_FOUND", identifier);
      return;
    }
    const authorization = req.headers.authorization;
    const suppliedEgressToken =
      typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
    if (
      !constantTimeEquals(suppliedEgressToken, tokenpakEgressToken) ||
      req.headers["content-encoding"] ||
      !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")
    ) {
      sendError(res, 401, "EGRESS_AUTH_REQUIRED", identifier);
      return;
    }
    const admission = limiter.admit("tokenpak");
    if (!admission.allowed) {
      sendError(res, 429, "EGRESS_RATE_LIMITED", identifier, {
        "retry-after": String(admission.retryAfterSeconds),
      });
      return;
    }
    if (inFlight >= maxConcurrency) {
      sendError(res, 503, "EGRESS_CONCURRENCY_EXHAUSTED", identifier, { "retry-after": "2" });
      return;
    }
    inFlight += 1;
    let body;
    let parsed;
    try {
      body = await readBoundedBody(req, maxRequestBytes, bodyTimeoutMs);
      body = canonicalInferencePayload(body, allowedModels);
      parsed = JSON.parse(body.toString("utf8"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "INVALID_REQUEST";
      const tooLarge = reason === "REQUEST_TOO_LARGE";
      const timedOut = reason === "REQUEST_TIMEOUT";
      if (!res.headersSent) {
        if (tooLarge || timedOut) res.once("finish", () => req.destroy());
        sendError(
          res,
          tooLarge ? 413 : timedOut ? 408 : 422,
          tooLarge ? "REQUEST_TOO_LARGE" : timedOut ? "REQUEST_TIMEOUT" : "INVALID_REQUEST",
          identifier,
          tooLarge || timedOut ? { connection: "close" } : {},
        );
      }
      inFlight -= 1;
      return;
    }
    const budgetAdmission = tokenBudgetLimiter.admit(
      "tokenpak",
      conservativeTokenBudget(body, parsed),
    );
    if (!budgetAdmission.allowed) {
      sendError(res, 429, "EGRESS_TOKEN_BUDGET_EXHAUSTED", identifier, {
        "retry-after": String(budgetAdmission.retryAfterSeconds),
      });
      inFlight -= 1;
      return;
    }

    try {
      const upstream = await fetchImpl(groqEndpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${groqApiKey}`,
          "content-type": "application/json",
          "x-request-id": identifier,
        },
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      let responseBody = await readBoundedWebResponse(upstream, maxResponseBytes);
      if (!upstream.ok) {
        const status = [400, 401, 403, 408, 413, 422, 429, 500, 502, 503, 504].includes(
          upstream.status,
        )
          ? upstream.status
          : 502;
        sendError(res, status, "GROQ_REJECTED", identifier, {
          ...(upstream.headers.get("retry-after")
            ? { "retry-after": upstream.headers.get("retry-after") }
            : {}),
        });
        return;
      }
      responseBody = canonicalCompletionResponse(responseBody);
      res.writeHead(200, {
        "cache-control": "private, no-store, max-age=0",
        "content-length": String(responseBody.length),
        "content-type": "application/json; charset=utf-8",
        "x-request-id": identifier,
      });
      res.end(responseBody);
    } catch {
      if (!res.headersSent) sendError(res, 502, "GROQ_UNAVAILABLE", identifier);
      else res.destroy();
    } finally {
      inFlight -= 1;
    }
  });
  server.on("connect", (_req, socket) => socket.destroy());
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.requestTimeout = 50_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 24;
  return server;
}

function start() {
  const groqApiKey = readRequiredSecret(process.env.GROQ_API_KEY_FILE, "GROQ_API_KEY");
  const tokenpakEgressToken = readRequiredSecret(
    process.env.TOKENPAK_EGRESS_TOKEN_FILE,
    "TOKENPAK_EGRESS_TOKEN",
  );
  const server = createEgressServer({ groqApiKey, tokenpakEgressToken });
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  server.listen(port, "0.0.0.0");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
