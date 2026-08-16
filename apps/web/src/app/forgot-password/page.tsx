import { Panel } from "@starguidance/design-system";

import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Account recovery</p>
        <h1 className="mt-3 text-4xl font-semibold">Reset your password.</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          Enter the email for your StarGuidance account. Recovery links are short-lived and can be
          used only once.
        </p>
        <ForgotPasswordForm />
      </Panel>
    </main>
  );
}
