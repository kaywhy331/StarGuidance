import { redirect } from "next/navigation";
import { Panel } from "@starguidance/design-system";
import { requireUser } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

const errorMessages: Record<string, string> = {
  "invalid-link": "That sign-in link is incomplete. Request a new link below.",
  "expired-link": "That link has expired or was already used. Request the newest link again.",
  "link-browser":
    "That link opened outside the browser that requested it. Return to the original browser and open the newest email there, or request a new link.",
  "service-unavailable": "We could not finish sign-in just now. Please request a fresh link.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  let authenticatedDestination: string | undefined;
  try {
    const user = await requireUser();
    authenticatedDestination = user.profile ? "/readings" : "/onboarding";
  } catch {
    // Rendering the sign-in form is the correct anonymous and fail-closed path.
  }
  if (authenticatedDestination) redirect(authenticatedDestination);

  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Private access</p>
        <h1 className="mt-3 text-4xl font-semibold">Your readings belong to you.</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          Enter your email for a private, one-time sign-in link. Use the newest link only; it
          expires shortly and cannot be reused.
        </p>
        <SignInForm initialError={errorCode ? errorMessages[errorCode] : undefined} />
      </Panel>
    </main>
  );
}
