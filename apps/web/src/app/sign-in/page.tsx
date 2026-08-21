import { redirect } from "next/navigation";
import { Panel } from "@starguidance/design-system";
import { safeAccountReturnPath } from "@/lib/account-return";
import { requireUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

const errorMessages: Record<string, string> = {
  "invalid-link": "That account link is incomplete. Request a new recovery email if needed.",
  "expired-link": "That account link has expired or was already used. Request a new one.",
  "link-browser":
    "That account link opened outside the browser that requested it. Return to the original browser or request a new recovery email.",
  "service-unavailable": "We could not finish that account request just now. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = safeAccountReturnPath(params.next);
  let authenticatedDestination: string | undefined;
  try {
    const user = await requireUser();
    authenticatedDestination = user.requiresPolicyReconsent
      ? "/consent"
      : (nextPath ?? (user.profile ? "/readings" : "/onboarding"));
  } catch {
    // Rendering the sign-in form is the correct anonymous and fail-closed path.
  }
  if (authenticatedDestination) redirect(authenticatedDestination);

  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Private access</p>
        <h1 className="mt-3 text-4xl font-semibold">Your readings belong to you.</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          Sign in with the email and password for your private StarGuidance account.
        </p>
        <SignInForm
          initialError={errorCode ? errorMessages[errorCode] : undefined}
          nextPath={nextPath}
        />
      </Panel>
    </main>
  );
}
