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
  createAccessVerifier,
  isLoopback,
  readBoundedBody,
  readRequiredSecret,
  requestId,
  sendError,
  sendJson,
} from "./security.mjs";

const EXACT_PATH = "/v1/chat/completions";

export function proxyToTokenPak({
  body,
  requestIdentifier,
  tokenpakUrl,
  tokenpakProxyToken,
  tokenpakUpstreamHost,
  timeoutMs,
  maxResponseBytes,
}) {
  const target = new URL(tokenpakUrl);
  return new Promise((resolve, reject) => {
    const upstream = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenpakProxyToken}`,
          "content-length": String(body.length),
          "content-type": "application/json",
          host: tokenpakUpstreamHost,
          "x-request-id": requestIdentifier,
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxResponseBytes) {
            response.destroy(new Error("RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 502,
            body: Buffer.concat(chunks, size),
            contentType: response.headers["content-type"],
            retryAfter: response.headers["retry-after"],
          }),
        );
        response.on("error", reject);
      },
    );
    upstream.on("timeout", () => upstream.destroy(new Error("UPSTREAM_TIMEOUT")));
    upstream.on("error", reject);
    upstream.end(body);
  });
}

export function createGatewayServer({
  gatewaySharedSecret,
  tokenpakProxyToken,
  accessVerifier,
  allowedModels = DEFAULT_ALLOWED_MODELS,
  tokenpakUrl = "http://tokenpak:8766/v1/chat/completions",
  tokenpakUpstreamHost = "groq-egress:8080",
  timeoutMs = 45_000,
  bodyTimeoutMs = 10_000,
  maxRequestBytes = DEFAULT_REQUEST_BYTES,
  maxResponseBytes = DEFAULT_RESPONSE_BYTES,
  rateLimit = 30,
  rateWindowMs = 60_000,
  maxConcurrency = 4,
  limiter = new FixedWindowRateLimiter(rateLimit, rateWindowMs),
  tokenBudgetLimiter = new FixedWindowBudgetLimiter(),
  proxyRequest = proxyToTokenPak,
}) {
  if (
    typeof gatewaySharedSecret !== "string" ||
    typeof tokenpakProxyToken !== "string" ||
    gatewaySharedSecret.length < 32 ||
    tokenpakProxyToken.length < 32
  )
    throw new Error("GATEWAY_SECRET_WEAK");
  const parsedTokenPakUrl = new URL(tokenpakUrl);
  if (
    parsedTokenPakUrl.protocol !== "http:" ||
    parsedTokenPakUrl.hostname !== "tokenpak" ||
    parsedTokenPakUrl.port !== "8766" ||
    parsedTokenPakUrl.pathname !== EXACT_PATH ||
    parsedTokenPakUrl.search ||
    parsedTokenPakUrl.hash
  )
    throw new Error("TOKENPAK_URL_INVALID");
  if (tokenpakUpstreamHost !== "groq-egress:8080")
    throw new Error("TOKENPAK_UPSTREAM_HOST_INVALID");
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32)
    throw new Error("MAX_CONCURRENCY_INVALID");
  if (typeof accessVerifier !== "function") throw new Error("ACCESS_VERIFIER_REQUIRED");

  let inFlight = 0;
  const server = http.createServer(async (req, res) => {
    const identifier = requestId(req.headers["x-request-id"]);
    res.setHeader("x-request-id", identifier);

    if (req.method === "GET" && req.url === "/healthz" && isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 200, { status: "ok" }, { "x-request-id": identifier });
      return;
    }
    if (req.method !== "POST" || req.url !== EXACT_PATH) {
      sendError(res, 404, "ROUTE_NOT_FOUND", identifier);
      return;
    }
    if (
      req.headers["content-encoding"] ||
      !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")
    ) {
      sendError(res, 415, "JSON_REQUIRED", identifier);
      return;
    }
    const authorization = req.headers.authorization;
    const suppliedGatewayToken =
      typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
    if (!constantTimeEquals(suppliedGatewayToken, gatewaySharedSecret)) {
      sendError(res, 401, "GATEWAY_AUTH_REQUIRED", identifier, {
        "www-authenticate": "StarGuidance-Proxy",
      });
      return;
    }

    let identity;
    try {
      identity = await accessVerifier(req.headers["cf-access-jwt-assertion"]);
    } catch {
      sendError(res, 403, "ACCESS_JWT_REJECTED", identifier);
      return;
    }
    const admission = limiter.admit(identity.subjectHash);
    if (!admission.allowed) {
      sendError(res, 429, "RATE_LIMITED", identifier, {
        "retry-after": String(admission.retryAfterSeconds),
      });
      return;
    }
    if (inFlight >= maxConcurrency) {
      sendError(res, 503, "CONCURRENCY_EXHAUSTED", identifier, { "retry-after": "2" });
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
      identity.subjectHash,
      conservativeTokenBudget(body, parsed),
    );
    if (!budgetAdmission.allowed) {
      sendError(res, 429, "TOKEN_BUDGET_EXHAUSTED", identifier, {
        "retry-after": String(budgetAdmission.retryAfterSeconds),
      });
      inFlight -= 1;
      return;
    }

    try {
      const response = await proxyRequest({
        body,
        requestIdentifier: identifier,
        tokenpakUrl,
        tokenpakProxyToken,
        tokenpakUpstreamHost,
        timeoutMs,
        maxResponseBytes,
      });
      if (response.status < 200 || response.status >= 300) {
        const status = [400, 401, 403, 408, 413, 422, 429, 500, 502, 503, 504].includes(
          response.status,
        )
          ? response.status
          : 502;
        sendError(res, status, "UPSTREAM_REJECTED", identifier, {
          ...(typeof response.retryAfter === "string"
            ? { "retry-after": response.retryAfter }
            : {}),
        });
        return;
      }
      const responseBody = canonicalCompletionResponse(response.body);
      res.writeHead(200, {
        "cache-control": "private, no-store, max-age=0",
        "content-length": String(responseBody.length),
        "content-type": "application/json; charset=utf-8",
        "x-request-id": identifier,
      });
      res.end(responseBody);
    } catch {
      if (!res.headersSent) sendError(res, 502, "UPSTREAM_UNAVAILABLE", identifier);
      else res.destroy();
    } finally {
      inFlight -= 1;
    }
  });
  server.on("connect", (_req, socket) => {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.requestTimeout = 50_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;
  return server;
}

function start() {
  const gatewaySharedSecret = readRequiredSecret(
    process.env.GATEWAY_SHARED_SECRET_FILE,
    "GATEWAY_SHARED_SECRET",
  );
  const tokenpakProxyToken = readRequiredSecret(
    process.env.TOKENPAK_PROXY_AUTH_TOKEN_FILE,
    "TOKENPAK_PROXY_AUTH_TOKEN",
  );
  const accessVerifier = createAccessVerifier({
    teamDomain: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
    audience: process.env.CLOUDFLARE_ACCESS_AUD,
    jwksUrl: process.env.CLOUDFLARE_ACCESS_JWKS_URL,
  });
  const allowedModels = (process.env.ALLOWED_MODELS ?? DEFAULT_ALLOWED_MODELS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    allowedModels.length !== DEFAULT_ALLOWED_MODELS.length ||
    allowedModels.some((model, index) => model !== DEFAULT_ALLOWED_MODELS[index])
  )
    throw new Error("ALLOWED_MODELS_MUST_MATCH_REVIEWED_CHAIN");
  const server = createGatewayServer({
    gatewaySharedSecret,
    tokenpakProxyToken,
    accessVerifier,
    allowedModels,
  });
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  server.listen(port, "0.0.0.0");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
