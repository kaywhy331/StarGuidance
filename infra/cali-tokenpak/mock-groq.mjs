import http from "node:http";
import { pathToFileURL } from "node:url";

import { constantTimeEquals, readBoundedBody, readRequiredSecret, sendJson } from "./security.mjs";

const EXACT_PATH = "/openai/v1/chat/completions";

export function createMockGroqServer({ expectedApiKey, rejectedProxyToken, port = 8082 } = {}) {
  if (typeof expectedApiKey !== "string" || expectedApiKey.length < 32)
    throw new Error("EXPECTED_GROQ_API_KEY_WEAK");
  const attempts = new Map();
  const observations = new Map();
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/__ci/observation/")) {
      const requestIdentifier = decodeURIComponent(req.url.slice("/__ci/observation/".length));
      const observed = observations.get(requestIdentifier);
      sendJson(res, observed ? 200 : 404, observed ?? { error: "NOT_FOUND" });
      return;
    }
    if (req.method !== "POST" || req.url !== EXACT_PATH) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }

    const requestIdentifier = req.headers["x-request-id"];
    const authorization = req.headers.authorization;
    const suppliedApiKey =
      typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
    let bodyBytes = 0;
    try {
      bodyBytes = (await readBoundedBody(req, 256 * 1024, 10_000)).length;
    } catch {
      sendJson(res, 400, { error: "INVALID_REQUEST" });
      return;
    }
    if (typeof requestIdentifier !== "string") {
      sendJson(res, 400, { error: "REQUEST_ID_REQUIRED" });
      return;
    }
    const count = (attempts.get(requestIdentifier) ?? 0) + 1;
    attempts.set(requestIdentifier, count);
    observations.set(requestIdentifier, {
      requestId: requestIdentifier,
      count,
      method: req.method,
      path: req.url,
      host: req.headers.host,
      bodyBytes,
      providerBearerAccepted: constantTimeEquals(suppliedApiKey, expectedApiKey),
      proxyBearerRejected:
        typeof rejectedProxyToken === "string" &&
        !constantTimeEquals(suppliedApiKey, rejectedProxyToken),
    });

    if (!constantTimeEquals(suppliedApiKey, expectedApiKey)) {
      sendJson(res, 401, { error: "AUTH_REQUIRED" });
      return;
    }
    if (requestIdentifier.includes("forced-failure")) {
      sendJson(res, 503, { error: "SYNTHETIC_RETRYABLE_FAILURE" }, { "retry-after": "0" });
      return;
    }
    sendJson(res, 200, {
      id: "must-be-stripped",
      object: "chat.completion",
      model: "must-be-stripped",
      usage: { prompt_tokens: 101, completion_tokens: 17 },
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: '{"synthetic":true}',
            reasoning: "must-be-stripped",
          },
        },
      ],
    });
  });
  server.listen(port, "0.0.0.0");
  return server;
}

function start() {
  const expectedApiKey = readRequiredSecret(
    process.env.EXPECTED_GROQ_API_KEY_FILE,
    "EXPECTED_GROQ_API_KEY",
  );
  const rejectedProxyToken = readRequiredSecret(
    process.env.REJECTED_PROXY_TOKEN_FILE,
    "REJECTED_PROXY_TOKEN",
  );
  createMockGroqServer({
    expectedApiKey,
    rejectedProxyToken,
    port: Number.parseInt(process.env.PORT ?? "8082", 10),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
