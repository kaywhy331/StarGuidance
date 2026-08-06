const prohibitedClaims: readonly { code: string; pattern: RegExp }[] = [
  {
    code: "guaranteed-outcome",
    pattern:
      /\b(?:(?:will|is going to)\s+(?:definitely|certainly)|guaranteed(?:\s+to|\s+that)?|without (?:a|any) doubt|inevitable(?:ly)?)\b/i,
  },
  {
    code: "physical-death",
    pattern: /\b(?:you|he|she|they|your partner)\s+(?:will|is going to)\s+die\b|\bdies?\s+on\b/i,
  },
  {
    code: "pregnancy-fact",
    pattern:
      /\b(?:you|she|they|your partner)\s+(?:are|is)\s+pregnant\b|\b(?:will|is going to)\s+(?:become|get)\s+pregnant\b/i,
  },
  {
    code: "medical-diagnosis",
    pattern:
      /\b(?:you|he|she|they)\s+(?:have|has|suffer(?:s)? from)\s+(?:cancer|diabetes|a disease|a disorder|a medical condition)\b|\b(?:the|your) diagnosis is\b/i,
  },
  {
    code: "mental-health-diagnosis",
    pattern:
      /\b(?:you|he|she|they|your partner)\s+(?:are|is)\s+(?:a narcissist|a psychopath|bipolar|mentally ill)\b/i,
  },
  {
    code: "legal-verdict",
    pattern:
      /\b(?:the )?(?:court|judge|jury)\s+will\s+(?:rule|decide|find)|\bwill\s+be\s+(?:convicted|acquitted|sentenced)\b/i,
  },
  {
    code: "criminal-guilt",
    pattern:
      /\b(?:you|he|she|they)\s+(?:are|is)\s+guilty\b|\bcommitted the (?:crime|murder|theft)\b/i,
  },
  {
    code: "infidelity-fact",
    pattern:
      /\b(?:he|she|they|your partner)\s+(?:is|are|has been|have been)\s+(?:cheating|unfaithful|having an affair)\b/i,
  },
  {
    code: "investment-return",
    pattern:
      /\b(?:investment|stock|crypto|portfolio)\b.{0,48}\b(?:will|is going to|guaranteed to)\s+(?:rise|gain|profit|return|double|increase)\b/i,
  },
  {
    code: "employment-guarantee",
    pattern:
      /\b(?:you|he|she|they)\s+(?:will|are guaranteed to|is guaranteed to)\s+(?:get|land|secure|be offered)\s+(?:the|that|a)\s+(?:job|role|position|promotion)\b/i,
  },
  {
    code: "third-party-secret",
    pattern:
      /\b(?:he|she|they|your partner)\s+(?:is|are)\s+hiding\s+(?:a|the|something|their)\b|\b(?:his|her|their)\s+secret (?:motive|is)\b/i,
  },
];

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) collectStrings(item, output);
}

/** Returns a fixed internal reason code; never returns or logs generated prose. */
export function generatedOutputSafetyViolation(value: unknown): string | undefined {
  const strings: string[] = [];
  collectStrings(value, strings);
  const text = strings.join(" \n ");
  return prohibitedClaims.find(({ pattern }) => pattern.test(text))?.code;
}
