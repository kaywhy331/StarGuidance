import http from "node:http";
import net from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEWED_GATEWAY_SYSTEM_PROMPTS, reviewedReadingResponseSchema } from "@starguidance/ai";
import { resolveSpreadPositions, spreads, tarotCards } from "@starguidance/tarot-content";

import { createAccessJwksServer } from "./access-jwks.mjs";
import { createEgressServer } from "./egress.mjs";
import { createGatewayServer, proxyToTokenPak } from "./gateway.mjs";
import { FixedWindowBudgetLimiter, FixedWindowRateLimiter } from "./security.mjs";

const GATEWAY_SECRET = "synthetic-gateway-secret-1234567890";
const TOKENPAK_PROXY_TOKEN = "synthetic-tokenpak-proxy-token-123456";
const TOKENPAK_EGRESS_TOKEN = "synthetic-tokenpak-egress-token-123456";
const GROQ_API_KEY = "synthetic-groq-provider-key-1234567890";
const servers = new Set();

const spread = spreads.find(({ id }) => id === "three-card");
const questionContext = {
  version: "question-classification-v1",
  topic: "career",
  horizon: "open",
  intent: "decisionSupport",
  generalReading: false,
};
const positions = resolveSpreadPositions(spread, questionContext);
const configuration = {
  version: "reading-configuration-v1",
  reversalMode: "reversals_enabled",
  personalizationMode: "personalized_tarot",
  positions,
  capabilities: spread.capabilities,
};
const cards = positions.map((position, index) => {
  const card = tarotCards[index + 10];
  const orientation = index === 1 ? "reversed" : "upright";
  return {
    positionId: position.id,
    positionName: position.displayName,
    positionMeans: position.interpretiveFunction,
    positionDescription: position.description,
    cardId: card.id,
    card: card.name,
    arcana: card.arcana,
    orientation,
    themes: orientation === "upright" ? card.uprightThemes : card.reversedThemes,
    domainTags: card.eventTags,
    approvedReversalFacets: orientation === "reversed" ? card.reversalFacets : [],
  };
});

function inferencePayload(overrides = {}) {
  const schema = reviewedReadingResponseSchema(
    cards.map((entry) => ({
      position: { id: entry.positionId, displayName: entry.positionName },
      card: { id: entry.cardId },
      orientation: entry.orientation,
    })),
    configuration,
  );
  return {
    model: "openai/gpt-oss-120b",
    temperature: 0.85,
    max_completion_tokens: 900,
    reasoning_effort: "low",
    include_reasoning: false,
    messages: [
      { role: "system", content: REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading },
      {
        role: "user",
        content: JSON.stringify({
          question: "Should I take the new role at work?",
          questionContext,
          spreadId: spread.id,
          spreadCapabilities: configuration.capabilities,
          trajectoryAllowed: configuration.capabilities.trajectoryPositionIds.length > 0,
          alternatePathAllowed: configuration.capabilities.alternativePositionGroups.length > 0,
          timingAllowed: configuration.capabilities.timingMethod !== null,
          personalizationAllowed: true,
          answerPositionId: cards[2].positionId,
          cards,
          readerLens: ["You commit quickly once a direction feels right."],
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "reading", strict: true, schema },
    },
    ...overrides,
  };
}

function completion(content = "{}", extras = {}) {
  return Buffer.from(
    JSON.stringify({
      id: "must-be-stripped",
      usage: { prompt_tokens: 100 },
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content, reasoning: "must-be-stripped" },
        },
      ],
      ...extras,
    }),
  );
}

async function listen(server) {
  servers.add(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...servers].map(closeServer));
  servers.clear();
});

async function gateway(options = {}) {
  const proxyRequest =
    options.proxyRequest ??
    vi.fn().mockResolvedValue({
      status: 200,
      body: completion(),
      contentType: "application/json",
    });
  const server = createGatewayServer({
    gatewaySharedSecret: GATEWAY_SECRET,
    tokenpakProxyToken: TOKENPAK_PROXY_TOKEN,
    accessVerifier: options.accessVerifier ?? (async () => ({ subjectHash: "subject" })),
    proxyRequest,
    ...options,
  });
  return { url: await listen(server), server, proxyRequest };
}

function gatewayHeaders(overrides = {}) {
  return {
    authorization: `Bearer ${GATEWAY_SECRET}`,
    "cf-access-jwt-assertion": "synthetic-access-jwt",
    "content-type": "application/json",
    ...overrides,
  };
}

async function rawHttp(port, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(request));
    socket.on("data", (chunk) => (response += chunk));
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

describe("gateway HTTP boundary", () => {
  it("requires both bearer and Access identity before forwarding", async () => {
    const accessVerifier = vi.fn(async (token) => {
      if (token !== "synthetic-access-jwt") throw new Error("invalid");
      return { subjectHash: "subject" };
    });
    const { url, proxyRequest } = await gateway({ accessVerifier });
    const body = JSON.stringify(inferencePayload());
    expect(
      (
        await fetch(`${url}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${url}/v1/chat/completions`, {
          method: "POST",
          headers: gatewayHeaders({ "cf-access-jwt-assertion": "wrong" }),
          body,
        })
      ).status,
    ).toBe(403);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/v1/chat/completions"],
    ["POST", "/v1/models"],
    ["POST", "/codex"],
    ["POST", "http://metadata.internal/latest"],
  ])("rejects %s %s", async (method, path) => {
    const { url, server, proxyRequest } = await gateway();
    if (path.startsWith("http://")) {
      const { port } = server.address();
      const response = await rawHttp(
        port,
        `POST ${path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${GATEWAY_SECRET}\r\nCF-Access-JWT-Assertion: synthetic-access-jwt\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`,
      );
      expect(response).toContain("404 Not Found");
    } else {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: gatewayHeaders(),
        ...(method === "POST" ? { body: JSON.stringify(inferencePayload()) } : {}),
      });
      expect(response.status).toBe(404);
    }
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it("rejects CONNECT and HTTP upgrade", async () => {
    const { server, proxyRequest } = await gateway();
    const { port } = server.address();
    const connect = await rawHttp(
      port,
      `CONNECT metadata.internal:80 HTTP/1.1\r\nHost: metadata.internal\r\n\r\n`,
    );
    expect(connect).toContain("404 Not Found");
    await rawHttp(
      port,
      `GET /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    );
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it("canonicalizes the request and returns only the app-consumed response envelope", async () => {
    const { url, proxyRequest } = await gateway();
    const payload = inferencePayload();
    const body = `${JSON.stringify(payload, null, 2)}   `;
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: gatewayHeaders(),
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    });
    const forwarded = proxyRequest.mock.calls[0][0];
    expect(forwarded.body.toString()).toBe(JSON.stringify(payload));
    expect(forwarded.tokenpakUrl).toBe("http://tokenpak:8766/v1/chat/completions");
    expect(forwarded.tokenpakUpstreamHost).toBe("groq-egress:8080");
  });

  it("rejects oversized, chunked-over-limit, and slow bodies without forwarding", async () => {
    const { server, proxyRequest } = await gateway({ maxRequestBytes: 512, bodyTimeoutMs: 30 });
    const { port } = server.address();
    const oversized = await rawHttp(
      port,
      `POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${GATEWAY_SECRET}\r\nCF-Access-JWT-Assertion: synthetic-access-jwt\r\nContent-Type: application/json\r\nContent-Length: 999\r\n\r\n`,
    );
    expect(oversized).toContain("413 Payload Too Large");
    const chunked = await rawHttp(
      port,
      `POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${GATEWAY_SECRET}\r\nCF-Access-JWT-Assertion: synthetic-access-jwt\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n258\r\n${"x".repeat(600)}\r\n0\r\n\r\n`,
    );
    expect(chunked).toContain("413 Payload Too Large");
    const slow = await new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1");
      let response = "";
      socket.setEncoding("utf8");
      socket.on("connect", () =>
        socket.write(
          `POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${GATEWAY_SECRET}\r\nCF-Access-JWT-Assertion: synthetic-access-jwt\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`,
        ),
      );
      socket.on("data", (chunk) => (response += chunk));
      socket.on("end", () => resolve(response));
      socket.on("error", reject);
    });
    expect(slow).toContain("408 Request Timeout");
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it("enforces request, token, and concurrency limits", async () => {
    let release;
    const pending = new Promise((resolve) => (release = resolve));
    const proxyRequest = vi.fn().mockImplementation(async () => {
      await pending;
      return { status: 200, body: completion() };
    });
    const { url } = await gateway({
      proxyRequest,
      maxConcurrency: 1,
      limiter: new FixedWindowRateLimiter(2, 60_000),
      tokenBudgetLimiter: new FixedWindowBudgetLimiter(100_000, 60_000),
    });
    const first = fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify(inferencePayload()),
    });
    await vi.waitFor(() => expect(proxyRequest).toHaveBeenCalledTimes(1));
    expect(
      (
        await fetch(`${url}/v1/chat/completions`, {
          method: "POST",
          headers: gatewayHeaders(),
          body: JSON.stringify(inferencePayload()),
        })
      ).status,
    ).toBe(503);
    release();
    expect((await first).status).toBe(200);

    const limited = await gateway({
      limiter: new FixedWindowRateLimiter(1, 60_000),
      tokenBudgetLimiter: new FixedWindowBudgetLimiter(100_000, 60_000),
    });
    expect(
      (
        await fetch(`${limited.url}/v1/chat/completions`, {
          method: "POST",
          headers: gatewayHeaders(),
          body: JSON.stringify(inferencePayload()),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${limited.url}/v1/chat/completions`, {
          method: "POST",
          headers: gatewayHeaders(),
          body: JSON.stringify(inferencePayload()),
        })
      ).status,
    ).toBe(429);

    const budgeted = await gateway({
      tokenBudgetLimiter: new FixedWindowBudgetLimiter(1_000, 60_000),
    });
    const response = await fetch(`${budgeted.url}/v1/chat/completions`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify(inferencePayload()),
    });
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("TOKEN_BUDGET_EXHAUSTED");
  });

  it.each([
    ["malformed", Buffer.from("not-json")],
    ["oversized", Buffer.alloc(2_001, 120)],
    ["provider-fields", completion("{}")],
  ])("handles %s upstream output", async (label, body) => {
    const maxResponseBytes = label === "oversized" ? 2_000 : 2 * 1024 * 1024;
    const { url } = await gateway({
      maxResponseBytes,
      proxyRequest: vi.fn().mockResolvedValue({ status: 200, body }),
    });
    const response = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify(inferencePayload()),
    });
    if (label === "provider-fields") {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        choices: [{ finish_reason: "stop", message: { content: "{}" } }],
      });
    } else expect(response.status).toBe(502);
  });
});

describe("fixed TokenPak proxy hop", () => {
  it("injects only the internal proxy bearer and fixed host/path", async () => {
    let observed;
    const upstream = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        observed = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(completion());
      });
    });
    const upstreamUrl = await listen(upstream);
    const target = new URL(upstreamUrl);
    const body = Buffer.from(JSON.stringify(inferencePayload()));
    const response = await proxyToTokenPak({
      body,
      requestIdentifier: "synthetic-request-id",
      tokenpakUrl: `${upstreamUrl}/v1/chat/completions`,
      tokenpakProxyToken: TOKENPAK_PROXY_TOKEN,
      tokenpakUpstreamHost: "groq-egress:8080",
      timeoutMs: 1_000,
      maxResponseBytes: 2 * 1024 * 1024,
    });
    expect(response.status).toBe(200);
    expect(observed).toMatchObject({ method: "POST", url: "/v1/chat/completions" });
    expect(observed.headers.authorization).toBe(`Bearer ${TOKENPAK_PROXY_TOKEN}`);
    expect(observed.headers.host).toBe("groq-egress:8080");
    expect(observed.body.equals(body)).toBe(true);
    expect(Number(target.port)).toBeGreaterThan(0);
  });
});

describe("Groq egress HTTP boundary", () => {
  async function egress(
    fetchImpl = vi.fn().mockResolvedValue(new Response(completion(), { status: 200 })),
    options = {},
  ) {
    const server = createEgressServer({
      fetchImpl,
      groqApiKey: GROQ_API_KEY,
      tokenpakEgressToken: TOKENPAK_EGRESS_TOKEN,
      ...options,
    });
    return { url: await listen(server), server, fetchImpl };
  }

  it("accepts one internal route/token and injects the Groq credential only to the fixed destination", async () => {
    const { url, fetchImpl } = await egress();
    const response = await fetch(`${url}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKENPAK_EGRESS_TOKEN}`,
        "content-type": "application/json",
        cookie: "must-not-forward",
      },
      body: JSON.stringify(inferencePayload()),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [destination, init] = fetchImpl.mock.calls[0];
    expect(destination).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(init.headers).toEqual(
      expect.objectContaining({
        authorization: `Bearer ${GROQ_API_KEY}`,
        "content-type": "application/json",
      }),
    );
    expect(init.headers).not.toHaveProperty("cookie");
    expect(init.headers).not.toHaveProperty("cf-access-jwt-assertion");
  });

  it("can target only the explicit internal provider used by the live CI chain proof", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(completion(), { status: 200 }));
    const { url } = await egress(fetchImpl, {
      groqEndpoint: "http://mock-groq:8082/openai/v1/chat/completions",
    });
    const response = await fetch(`${url}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKENPAK_EGRESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(inferencePayload()),
    });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://mock-groq:8082/openai/v1/chat/completions");
  });

  it("rejects wrong auth/routes and normalizes redirects, timeouts, and oversized responses", async () => {
    const { url, fetchImpl } = await egress();
    const body = JSON.stringify(inferencePayload());
    expect(
      (
        await fetch(`${url}/openai/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${url}/models`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKENPAK_EGRESS_TOKEN}`,
            "content-type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();

    for (const [mock, options] of [
      [
        vi
          .fn()
          .mockResolvedValue(
            new Response(null, { status: 302, headers: { location: "http://metadata.internal" } }),
          ),
        {},
      ],
      [vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")), {}],
      [vi.fn().mockResolvedValue(new Response(Buffer.alloc(2_001))), { maxResponseBytes: 2_000 }],
    ]) {
      const instance = await egress(mock, options);
      const response = await fetch(`${instance.url}/openai/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKENPAK_EGRESS_TOKEN}`,
          "content-type": "application/json",
        },
        body,
      });
      expect(response.status).toBe(502);
    }
  });

  it("independently bounds valid replay, token budget, and concurrency", async () => {
    const body = JSON.stringify(inferencePayload());
    const headers = {
      authorization: `Bearer ${TOKENPAK_EGRESS_TOKEN}`,
      "content-type": "application/json",
    };
    const rateLimited = await egress(undefined, {
      limiter: new FixedWindowRateLimiter(1, 60_000),
    });
    expect(
      (
        await fetch(`${rateLimited.url}/openai/v1/chat/completions`, {
          method: "POST",
          headers,
          body,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${rateLimited.url}/openai/v1/chat/completions`, {
          method: "POST",
          headers,
          body,
        })
      ).status,
    ).toBe(429);

    const budgetLimited = await egress(undefined, {
      tokenBudgetLimiter: new FixedWindowBudgetLimiter(1, 60_000),
    });
    expect(
      (
        await fetch(`${budgetLimited.url}/openai/v1/chat/completions`, {
          method: "POST",
          headers,
          body,
        })
      ).status,
    ).toBe(429);
    expect(budgetLimited.fetchImpl).not.toHaveBeenCalled();

    let release;
    const slowFetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(new Response(completion(), { status: 200 }));
        }),
    );
    const concurrencyLimited = await egress(slowFetch, { maxConcurrency: 1 });
    const first = fetch(`${concurrencyLimited.url}/openai/v1/chat/completions`, {
      method: "POST",
      headers,
      body,
    });
    await vi.waitFor(() => expect(slowFetch).toHaveBeenCalledTimes(1));
    expect(
      (
        await fetch(`${concurrencyLimited.url}/openai/v1/chat/completions`, {
          method: "POST",
          headers,
          body,
        })
      ).status,
    ).toBe(503);
    release();
    expect((await first).status).toBe(200);
  });
});

describe("Access JWKS relay boundary", () => {
  it("uses the fixed team cert destination, blocks redirects, bounds and canonicalizes keys", async () => {
    const n = "a".repeat(342);
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        ignored: true,
        keys: [
          {
            kty: "RSA",
            alg: "RS256",
            use: "sig",
            kid: "key-1",
            n,
            e: "AQAB",
            x5c: ["must-strip"],
          },
        ],
      }),
    );
    const server = createAccessJwksServer({
      teamDomain: "https://starguidance.cloudflareaccess.com",
      fetchImpl,
    });
    const url = await listen(server);
    const response = await fetch(`${url}/certs`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      keys: [{ kty: "RSA", alg: "RS256", use: "sig", kid: "key-1", n, e: "AQAB" }],
    });
    const [destination, init] = fetchImpl.mock.calls[0];
    expect(destination.href).toBe("https://starguidance.cloudflareaccess.com/cdn-cgi/access/certs");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error" });

    for (const [mock, maxResponseBytes] of [
      [
        vi
          .fn()
          .mockResolvedValue(
            new Response(null, { status: 302, headers: { location: "http://metadata.internal" } }),
          ),
        64 * 1024,
      ],
      [vi.fn().mockResolvedValue(Response.json({ keys: [{ kty: "oct", kid: "bad" }] })), 64 * 1024],
      [vi.fn().mockResolvedValue(new Response(Buffer.alloc(2_001))), 2_000],
    ]) {
      const instance = createAccessJwksServer({
        teamDomain: "https://starguidance.cloudflareaccess.com",
        fetchImpl: mock,
        maxResponseBytes,
      });
      const instanceUrl = await listen(instance);
      expect((await fetch(`${instanceUrl}/certs`)).status).toBe(502);
    }
  });
});
