import { AccountThreshold } from "../sign-up/account-threshold";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AccountThreshold
      eyebrow="It happens to everyone"
      lede="Tell us the email you signed up with and we'll send a link to choose a new password. Your readings stay exactly as they are."
      panelEyebrow="Password help"
      panelLede="For your safety, the link works once and only for a short while."
      panelTitle="Reset your password."
      title="Let's get you back in."
    >
      <ForgotPasswordForm />
    </AccountThreshold>
  );
}
