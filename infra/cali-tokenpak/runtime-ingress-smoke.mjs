import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const testCase = process.argv[2] ?? "success";
assert.ok(["success", "forced-failure"].includes(testCase));

const gatewayToken = readFileSync("/run/secrets/gateway_shared_secret", "utf8").trim();
const payload = readFileSync("/tmp/chain-payload.json");
const accessJwt = readFileSync("/tmp/access.jwt", "utf8").trim();
const requestIdentifier = `ci-chain-${testCase}-12345678`;

const response = await fetch("http://ingress:8787/v1/chat/completions", {
  method: "POST",
  headers: {
    authorization: `Bearer ${gatewayToken}`,
    "cf-access-jwt-assertion": accessJwt,
    "content-type": "application/json",
    "x-request-id": requestIdentifier,
  },
  body: payload,
});

if (testCase === "success") {
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    choices: [{ finish_reason: "stop", message: { content: '{"synthetic":true}' } }],
  });
} else {
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "UPSTREAM_REJECTED", requestId: requestIdentifier },
  });
}
