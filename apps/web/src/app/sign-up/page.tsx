import { redirect } from "next/navigation";
import Link from "next/link";
import { Panel } from "@starguidance/design-system";

import { safeAccountReturnPath } from "@/lib/account-return";
import { requireUser } from "@/lib/auth";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
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
    // Anonymous visitors should see the registration form.
  }
  if (authenticatedDestination) redirect(authenticatedDestination);

  return (
    <main className="account-threshold-shell">
      <section aria-labelledby="account-threshold-heading" className="account-threshold-story">
        <Link className="account-threshold-brand" href="/">
          <span aria-hidden="true">✦</span> StarGuidance
        </Link>
        <div>
          <p className="page-eyebrow">Your first private threshold</p>
          <h1 id="account-threshold-heading">A quiet place begins with a protected key.</h1>
          <p>
            Create the private space that will hold your profile snapshots, immutable card draws,
            and every thread you choose to keep.
          </p>
        </div>
        <ol aria-label="Private account promise" className="account-threshold-promises">
          <li>
            <span>01</span>
            <strong>One identity</strong>
            <small>Your reading name stays separate from your encrypted birth name.</small>
          </li>
          <li>
            <span>02</span>
            <strong>Explicit permission</strong>
            <small>You review the privacy commitments before the space is created.</small>
          </li>
          <li>
            <span>03</span>
            <strong>No altered cards</strong>
            <small>Your account and profile can shape interpretation, never the draw.</small>
          </li>
        </ol>
        <div aria-hidden="true" className="account-threshold-orbit">
          <i />
          <span>Private by design</span>
        </div>
      </section>

      <Panel className="account-threshold-panel">
        <p className="page-eyebrow">Private account</p>
        <h2>Create your private space.</h2>
        <p>
          Your email unlocks this space. Profile details and readings remain isolated to your
          account.
        </p>
        <SignUpForm nextPath={nextPath} />
      </Panel>
    </main>
  );
}
