import "server-only";

import { cookies } from "next/headers";

import { getLocalUser } from "./local-store";

export const SESSION_COOKIE = "starguidance_session";

export async function requireUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = getLocalUser(token);
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
