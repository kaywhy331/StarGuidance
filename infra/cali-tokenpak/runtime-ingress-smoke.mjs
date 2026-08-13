import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gatewayToken = readFileSync("/run/secrets/gateway_shared_secret", "utf8").trim();
const payload = readFileSync("/tmp/chain-payload.json");
const accessJwt = readFileSync("/tmp/access.jwt", "utf8").trim();

const response = await fetch("http://ingress:8787/v1/chat/completions", {
  method: "POST",
  headers: {
    authorization: `Bearer ${gatewayToken}`,
    "cf-access-jwt-assertion": accessJwt,
    "content-type": "application/json",
    "x-request-id": "ci-chain-ingress-success-12345678",
  },
  body: payload,
});
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), {
  choices: [{ finish_reason: "stop", message: { content: '{"synthetic":true}' } }],
});
