import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  const result: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) result.push(path);
  }
  return result;
}

describe("telemetry boundary", () => {
  it("has no server-side content logger or telemetry SDK until an allowlisted adapter exists", () => {
    const serverSource = [
      ...sourceFiles(join(process.cwd(), "src", "app", "api")),
      ...sourceFiles(join(process.cwd(), "src", "lib")),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(serverSource).not.toMatch(/console\.(log|info|warn|error|debug)\s*\(/);
    expect(serverSource).not.toMatch(
      /captureException\s*\(|posthog\.|analytics\.(track|identify)\s*\(/,
    );
  });

  it("does not install a telemetry vendor that could receive raw payloads implicitly", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    expect(packageJson).not.toMatch(/sentry|posthog|segment|mixpanel/i);
  });
});
