import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false, follow: false },
};

export default function GoodbyePage() {
  return (
    <main className="settings-shell goodbye-shell">
      <section className="account-state-panel goodbye-panel" role="status">
        <span aria-hidden="true" className="account-state-panel__mark">
          ✦
        </span>
        <p className="page-eyebrow">Account deleted</p>
        <h1>Your account has been deleted</h1>
        <p>
          Your sign-in identity and the data held in your account — profile, saved people, saved
          readings, and atlases — are gone, and you’ve been signed out on this device. Thank you for
          the questions you brought here.
        </p>
        <p>
          A free guest reading kept in a browser is a separate copy and isn’t cleared by deleting
          your account; it stops working on its own seven days after it was made.
        </p>
        <p>If you ever want to return, you’re welcome to start fresh.</p>
        <div className="account-state-panel__actions">
          <Link href="/">Return home</Link>
          <Link href="/free-reading">Try a free reading</Link>
        </div>
      </section>
    </main>
  );
}
