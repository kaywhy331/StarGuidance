import "server-only";

import { z } from "zod";

import { requireUser } from "./auth";

export const OPERATIONAL_ACCESS_DENIED = "OPERATIONAL_ACCESS_DENIED";
export type OperationalRole = "support" | "operator";

function configuredIds(name: "SUPPORT_USER_IDS" | "OPERATOR_USER_IDS"): Set<string> {
  const values = (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const parsed = z.array(z.string().uuid()).safeParse(values);
  if (!parsed.success) throw new Error("OPERATIONAL_ACCESS_MISCONFIGURED");
  return new Set(parsed.data);
}

export async function requireOperationalRole(
  minimum: OperationalRole,
  authenticatedUser?: Awaited<ReturnType<typeof requireUser>>,
): Promise<Awaited<ReturnType<typeof requireUser>> & { operationalRole: OperationalRole }> {
  const user = authenticatedUser ?? (await requireUser());
  const operators = configuredIds("OPERATOR_USER_IDS");
  const support = configuredIds("SUPPORT_USER_IDS");
  const operationalRole: OperationalRole | undefined = operators.has(user.id)
    ? "operator"
    : support.has(user.id)
      ? "support"
      : undefined;
  if (!operationalRole || (minimum === "operator" && operationalRole !== "operator"))
    throw new Error(OPERATIONAL_ACCESS_DENIED);
  return { ...user, operationalRole };
}
