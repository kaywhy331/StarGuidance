import Link from "next/link";

import { AccountThreshold } from "../sign-up/account-threshold";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AccountThreshold
      eyebrow="Almost there"
      lede="Pick something you'll remember. Once it's saved, you'll sign in again with your new password."
      panelEyebrow="New password"
      panelLede={
        <>
          This page works after opening the reset link from your email. If it has expired,{" "}
          <Link className="account-inline-link" href="/forgot-password">
            request a new one
          </Link>
          .
        </>
      }
      panelTitle="Choose a new password."
      title="A fresh key for your space."
    >
      <ResetPasswordForm />
    </AccountThreshold>
  );
}
