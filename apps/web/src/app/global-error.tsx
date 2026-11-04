"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for failures in the root layout itself. It replaces
 * the whole document, so it carries its own html/body and inline styles
 * rather than relying on the app's stylesheets having loaded.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong · StarGuidance</title>
        <meta content="width=device-width, initial-scale=1" name="viewport" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem 1rem",
          boxSizing: "border-box",
          background: "radial-gradient(circle at 50% 0%, #241a3d 0%, #0b0915 55%, #06050d 100%)",
          color: "#f7f1e4",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: "34rem", textAlign: "center" }}>
          <p aria-hidden="true" style={{ color: "#deb86a", fontSize: "2rem", margin: 0 }}>
            ✦
          </p>
          <h1
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 400,
              fontSize: "clamp(2rem, 6vw, 3rem)",
              lineHeight: 1.1,
              margin: "1rem 0",
            }}
          >
            The stars went quiet for a moment.
          </h1>
          <p style={{ color: "#c9bfd4", lineHeight: 1.7, margin: "0 0 2rem" }}>
            StarGuidance couldn&apos;t open just now. Nothing you&apos;ve saved has been lost.
            Please try again in a moment.
          </p>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}
          >
            <button
              onClick={() => reset()}
              style={{
                minHeight: "2.75rem",
                padding: "0 1.4rem",
                border: 0,
                borderRadius: "999px",
                background: "#deb86a",
                color: "#130e1b",
                font: "inherit",
                fontWeight: 600,
                cursor: "pointer",
              }}
              type="button"
            >
              Try again
            </button>
            {/* A full page load is deliberate: the app shell itself failed. */}
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "2.75rem",
                padding: "0 1.4rem",
                border: "1px solid rgba(247, 241, 228, 0.3)",
                borderRadius: "999px",
                color: "#f7f1e4",
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>
          {error.digest ? (
            <p style={{ color: "#8f86a0", fontSize: "0.8rem", marginTop: "2rem" }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
