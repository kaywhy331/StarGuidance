import Link from "next/link";

import { Panel } from "@starguidance/design-system";

export default function SignInPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-16">
      <Panel>
        <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Private access</p>
        <h1 className="mt-3 text-4xl font-semibold">Your readings belong to you.</h1>
        <p className="mt-4 leading-7 text-[#c9bfd4]">
          Production uses Supabase passwordless email. The local authentication adapter will be
          enabled in the persistence slice; no birth data is accepted anonymously.
        </p>
        <Link className="mt-8 inline-flex rounded-full border border-white/20 px-5 py-3" href="/">
          Return home
        </Link>
      </Panel>
    </main>
  );
}
