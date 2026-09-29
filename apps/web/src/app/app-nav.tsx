"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { sendJson } from "@/lib/client-request";

const links = [
  ["Read", "/readings", "✦"],
  ["History", "/history", "◴"],
  ["Reports", "/reports", "⌑"],
  ["Profile", "/profile", "◇"],
  ["People", "/people", "♊"],
  ["Account", "/settings/account", "○"],
  ["Privacy", "/settings/privacy", "◈"],
] as const;

const anonymousLinks = [
  ["Free reading", "/free-reading", "✦"],
  ["Sign in", "/sign-in", "○"],
  ["Sign up", "/sign-up", "◇"],
] as const;

const hiddenRoutes = [
  "/",
  "/readings",
  "/visual-preview",
  "/free-reading",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
] as const;

export function AppNav({ signedIn = false }: { signedIn?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  if (
    hiddenRoutes.includes(pathname as (typeof hiddenRoutes)[number]) ||
    pathname.startsWith("/session/") ||
    pathname.startsWith("/reading/")
  )
    return null;

  return (
    <header className="site-header">
      <nav aria-label="Primary navigation" className="site-nav">
        <Link
          aria-label="StarGuidance home"
          className="site-brand"
          href="/"
          onClick={() => setMenuOpen(false)}
        >
          <span aria-hidden="true" className="site-brand__mark">
            <i />
          </span>
          <span>StarGuidance</span>
        </Link>

        <button
          aria-controls={menuId}
          aria-expanded={menuOpen}
          className="site-menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          <span>{menuOpen ? "Close" : "Menu"}</span>
          <span aria-hidden="true" className="site-menu-toggle__glyph">
            <i />
            <i />
          </span>
        </button>

        <div className="site-nav-panel" data-open={menuOpen} id={menuId}>
          <div className="site-nav-links">
            {(signedIn ? links : anonymousLinks).map(([label, href, glyph]) => (
              <Link
                aria-current={pathname.startsWith(href) ? "page" : undefined}
                href={href}
                key={href}
                onClick={() => setMenuOpen(false)}
              >
                <span aria-hidden="true">{glyph}</span>
                {label}
              </Link>
            ))}
          </div>
          {signedIn ? (
            <button
              className="site-sign-out"
              disabled={signingOut}
              onClick={async () => {
                setSignOutError(undefined);
                setSigningOut(true);
                const result = await sendJson("/api/auth", "DELETE");
                setSigningOut(false);
                if (!result.ok) {
                  setSignOutError(result.error);
                  return;
                }
                setMenuOpen(false);
                router.push("/");
                router.refresh();
              }}
              type="button"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          ) : null}
          {signOutError ? (
            <span className="site-nav-error" role="alert">
              {signOutError}
            </span>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
