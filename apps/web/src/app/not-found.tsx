import Link from "next/link";

import { hasSessionHint } from "./session-hint";

export const metadata = { title: "Page not found" };

export default async function NotFound() {
  const signedIn = await hasSessionHint();
  return (
    <main className="threshold-lost">
      <span aria-hidden="true" className="threshold-lost__mark">
        ✦
      </span>
      <p className="page-eyebrow">Page not found</p>
      <h1>This path isn&apos;t written in the stars.</h1>
      <p>
        The page you were looking for has moved, or was never here. Let&apos;s find you somewhere
        calmer to land.
      </p>
      <nav aria-label="Ways back" className="threshold-lost__actions">
        <Link className="sg-button sg-button--primary" href="/">
          Home
        </Link>
        {signedIn ? (
          <Link className="sg-button sg-button--secondary" href="/readings">
            Your readings
          </Link>
        ) : (
          <Link className="sg-button sg-button--secondary" href="/free-reading">
            Free reading
          </Link>
        )}
        {signedIn ? (
          <Link className="sg-button sg-button--quiet" href="/history">
            History
          </Link>
        ) : (
          <Link className="sg-button sg-button--quiet" href="/sign-in">
            Sign in to your readings
          </Link>
        )}
      </nav>
    </main>
  );
}
