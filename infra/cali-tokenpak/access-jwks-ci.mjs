import { createAccessJwksServer } from "./access-jwks.mjs";

const teamDomain = process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
const expected = new URL(`${teamDomain}/cdn-cgi/access/certs`);
const fetchImpl = async (destination, init) => {
  if (destination.href !== expected.href || init?.redirect !== "error")
    return new Response(null, { status: 502 });
  return new Response(process.env.CI_ACCESS_JWKS ?? "", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const server = createAccessJwksServer({ teamDomain, fetchImpl });
server.listen(Number.parseInt(process.env.PORT ?? "8081", 10), "0.0.0.0");
