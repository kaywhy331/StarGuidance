import { redirect } from "next/navigation";
import { Panel } from "@starguidance/design-system";

import { requireUser } from "@/lib/auth";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  let authenticatedDestination: string | undefined;
  try {
    const user = await requireUser();
    authenticatedDestination = user.profile ? "/readings" : "/onboarding";
  } catch {
    // Anonymous visitors should see the registration form.
  }
  if (authenticatedDestination) redirect(authenticatedDestination);

  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Private account</p>
        <h1 className="mt-3 text-4xl font-semibold">Create your private space.</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          Your email signs you into StarGuidance. Profile details and readings remain isolated to
          your account.
        </p>
        <SignUpForm />
      </Panel>
    </main>
  );
}
