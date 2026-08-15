import { Panel } from "@starguidance/design-system";

import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Private account</p>
        <h1 className="mt-3 text-4xl font-semibold">Choose a new password.</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          This page works only after opening a valid, one-time recovery email.
        </p>
        <ResetPasswordForm />
      </Panel>
    </main>
  );
}
