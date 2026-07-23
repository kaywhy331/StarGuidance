import { Panel } from "@starguidance/design-system";
import { LocalSignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Private access</p>
        <h1 className="mt-3 text-4xl font-semibold">Your readings belong to you.</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          Production uses Supabase passwordless email. This build uses an HttpOnly local development
          session and disables that adapter in production.
        </p>
        <LocalSignInForm />
      </Panel>
    </main>
  );
}
