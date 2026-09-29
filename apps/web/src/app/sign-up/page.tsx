import { redirect } from "next/navigation";

import { safeAccountReturnPath } from "@/lib/account-return";
import { requireUser } from "@/lib/auth";
import { AccountThreshold, type ThresholdPromise } from "./account-threshold";
import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Create an account" };

const promises: readonly ThresholdPromise[] = [
  {
    title: "Yours alone",
    detail: "Your readings and birth details stay private to your account.",
  },
  {
    title: "Your say first",
    detail: "You read and agree to the Terms and Privacy Notice before anything is created.",
  },
  {
    title: "Honest cards",
    detail: "Your details shape how a reading is written, never which cards appear.",
  },
];

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
    <AccountThreshold
      eyebrow="Your own quiet corner"
      lede="Keep your readings, ask follow-up questions, and let a private profile make each reading feel more like yours."
      panelEyebrow="Create an account"
      panelLede="It takes a minute. Only you can see what you keep here."
      panelTitle="Make a space of your own."
      promises={promises}
      title="A place to come back to."
    >
      <SignUpForm nextPath={nextPath} />
    </AccountThreshold>
  );
}
