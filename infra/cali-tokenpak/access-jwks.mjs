import http from "node:http";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_JWKS_BYTES,
  canonicalJwks,
  isLoopback,
  readBoundedWebResponse,
  requestId,
  sendError,
  sendJson,
} from "./security.mjs";

function signingKeysUrl(teamDomain) {
  const url = new URL(teamDomain);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    hostname === "cloudflareaccess.com" ||
    !hostname.endsWith(".cloudflareaccess.com") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("CLOUDFLARE_ACCESS_TEAM_DOMAIN_INVALID");
  return new URL("/cdn-cgi/access/certs", url.origin);
}

/** A content-blind relay with exactly one outbound destination: Access JWKS. */
export function createAccessJwksServer({
  teamDomain,
  fetchImpl = fetch,
  maxResponseBytes = DEFAULT_JWKS_BYTES,
} = {}) {
  const target = signingKeysUrl(teamDomain);
  const server = http.createServer(async (req, res) => {
    const identifier = requestId(req.headers["x-request-id"]);
    if (req.method === "GET" && req.url === "/healthz" && isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 200, { status: "ok" }, { "x-request-id": identifier });
      return;
    }
    if (req.method !== "GET" || req.url !== "/certs") {
      sendError(res, 404, "ROUTE_NOT_FOUND", identifier);
      return;
    }
    try {
      const response = await fetchImpl(target, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        sendError(res, 502, "ACCESS_JWKS_UNAVAILABLE", identifier);
        return;
      }
      const body = canonicalJwks(await readBoundedWebResponse(response, maxResponseBytes));
      res.writeHead(200, {
        "cache-control": "private, max-age=300",
        "content-length": String(body.length),
        "content-type": "application/json; charset=utf-8",
        "x-request-id": identifier,
      });
      res.end(body);
    } catch {
      if (!res.headersSent) sendError(res, 502, "ACCESS_JWKS_UNAVAILABLE", identifier);
      else res.destroy();
    }
  });
  server.on("connect", (_req, socket) => socket.destroy());
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 16;
  return server;
}

function start() {
  const server = createAccessJwksServer({
    teamDomain: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
  });
  const port = Number.parseInt(process.env.PORT ?? "8081", 10);
  server.listen(port, "0.0.0.0");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
