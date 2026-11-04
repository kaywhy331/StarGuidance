"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    // Surface the failure to the browser console for support, never to the page.
    console.error(error);
  }, [error]);

  return (
    <main className="threshold-lost">
      <span aria-hidden="true" className="threshold-lost__mark">
        ☾
      </span>
      <p className="page-eyebrow">A quiet interruption</p>
      <h1 ref={headingRef} tabIndex={-1}>
        Something slipped out of place.
      </h1>
      <p>
        This page didn&apos;t load as it should. Nothing you&apos;ve saved has been lost. Take a
        breath and try again — it usually settles on the second try.
      </p>
      <div className="threshold-lost__actions">
        <button className="sg-button sg-button--primary" onClick={() => reset()} type="button">
          Try again
        </button>
        <Link className="sg-button sg-button--secondary" href="/">
          Go home
        </Link>
      </div>
      {error.digest ? <p className="threshold-lost__reference">Reference: {error.digest}</p> : null}
    </main>
  );
}
