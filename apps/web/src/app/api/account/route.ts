import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { assertSameOrigin } from "@/lib/request-security";
import { getRuntimeAdapter } from "@/lib/runtime";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await persistenceFor(user).repositories.privacy.deleteAccount(user.id);
    if (getRuntimeAdapter() === "supabase") {
      const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(user.id);
      if (error) throw error;
      await (await createSupabaseServerClient()).auth.signOut();
    }
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
