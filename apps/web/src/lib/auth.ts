import "server-only";

import { cookies } from "next/headers";

import { getLocalUser } from "./local-store";
import { getRepositoriesForUser, getRuntimeAdapter } from "./runtime";
import { createSupabaseServerClient } from "./supabase";

export const SESSION_COOKIE = "starguidance_session";

export async function requireUser() {
  if (getRuntimeAdapter() === "local") {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const user = getLocalUser(token);
    if (!user) throw new Error("UNAUTHENTICATED");
    return user;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) throw new Error("UNAUTHENTICATED");
  const repositories = getRepositoriesForUser(data.user.id);
  const persisted = await repositories.users.ensure({ id: data.user.id, email: data.user.email });
  const [profile, consents] = await Promise.all([
    repositories.birthProfiles.getActive(persisted.id),
    repositories.consents.list(persisted.id),
  ]);
  return {
    ...persisted,
    profile,
    consentRecords: consents.map(({ version, grantedAt }) => ({ version, grantedAt })),
  };
}
