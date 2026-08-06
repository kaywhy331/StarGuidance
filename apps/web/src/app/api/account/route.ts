import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter, RuntimeConfigurationError } from "@/lib/runtime";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase";

const deletionSchema = z.object({
  confirmation: z.literal("DELETE"),
  password: z.string().min(12).max(72),
});

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`account-delete:${user.id}`, 3, 60 * 60 * 1000);
    const input = deletionSchema.parse(await request.json());
    if (getRuntimeAdapter() === "supabase") {
      const supabase = await createSupabaseServerClient();
      const { error: authenticationError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: input.password,
      });
      if (authenticationError)
        return NextResponse.json(
          { error: "Enter your current password to authorize account deletion." },
          { status: 403 },
        );
      const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(user.id);
      if (error)
        return NextResponse.json(
          {
            error:
              "The authentication provider could not confirm account deletion. No success was recorded; check account access before retrying or contact support.",
          },
          { status: 502 },
        );
      // public.users has an enforced ON DELETE CASCADE foreign key to
      // auth.users. Deleting the identity first makes identity + application
      // data one provider-side database operation instead of a partial two-step
      // deletion that could strand a usable login.
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Identity deletion is already authoritative. Browser auth cookies are
        // cleared below even if the client-side sign-out transport fails.
      }
    } else await persistenceFor(user).repositories.privacy.deleteAccount(user.id);

    const jar = await cookies();
    for (const { name } of jar.getAll())
      if (name === SESSION_COOKIE || (name.startsWith("sb-") && name.includes("auth-token")))
        jar.delete(name);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: 'Type "DELETE" and enter your current password.' },
        { status: 422 },
      );
    if (error instanceof RuntimeConfigurationError)
      return NextResponse.json({ error: "Account deletion is not configured." }, { status: 503 });
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(
      { error: "Account deletion could not be completed. No success was recorded." },
      { status: 500 },
    );
  }
}
