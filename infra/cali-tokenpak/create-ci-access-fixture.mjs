import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { writeFileSync } from "node:fs";

const audience = process.argv[2];
const issuer = process.argv[3];
const jwksPath = process.argv[4];
const tokenPath = process.argv[5];
if (!audience || !issuer || !jwksPath || !tokenPath)
  throw new Error("CI_ACCESS_ARGUMENTS_REQUIRED");

const kid = "synthetic-ci-access-key";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const now = Math.floor(Date.now() / 1_000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = encode({ alg: "RS256", typ: "JWT", kid });
const payload = encode({
  iss: issuer,
  aud: audience,
  sub: randomUUID(),
  iat: now,
  nbf: now - 5,
  exp: now + 300,
});
const unsigned = `${header}.${payload}`;
const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
const jwk = publicKey.export({ format: "jwk" });

writeFileSync(
  jwksPath,
  JSON.stringify({ keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid }] }),
  { mode: 0o600 },
);
writeFileSync(tokenPath, `${unsigned}.${signature}\n`, { mode: 0o600 });
