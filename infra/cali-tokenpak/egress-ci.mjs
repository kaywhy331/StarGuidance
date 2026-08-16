import { createEgressServer } from "./egress.mjs";
import { readRequiredSecret } from "./security.mjs";

const groqApiKey = readRequiredSecret(process.env.GROQ_API_KEY_FILE, "GROQ_API_KEY");
const tokenpakEgressToken = readRequiredSecret(
  process.env.TOKENPAK_EGRESS_TOKEN_FILE,
  "TOKENPAK_EGRESS_TOKEN",
);
const server = createEgressServer({
  groqApiKey,
  tokenpakEgressToken,
  groqEndpoint: "http://mock-groq:8082/openai/v1/chat/completions",
});
server.listen(Number.parseInt(process.env.PORT ?? "8080", 10), "0.0.0.0");
