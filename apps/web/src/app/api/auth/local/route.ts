import { NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_COOKIE } from "@/lib/auth";
import { createLocalSession } from "@/lib/local-store";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";

const requestSchema = z.object({ email: z.email() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(
      `auth:${request.headers.get("x-forwarded-for") ?? "local"}`,
      process.env.APP_ENV === "test" ? 200 : 30,
    );
    const { email } = requestSchema.parse(await request.json());
    const { token } = createLocalSession(email);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.APP_ENV === "production",
      maxAge: 60 * 60 * 8,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "Unable to create a local development session." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  assertSameOrigin(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}
