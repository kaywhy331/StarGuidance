"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const links = [
  ["Read", "/readings", "✦"],
  ["History", "/history", "◴"],
  ["Reports", "/reports", "⌑"],
  ["Profile", "/profile", "◇"],
  ["Account", "/settings/account", "○"],
  ["Privacy", "/settings/privacy", "◈"],
] as const;

const hiddenRoutes = [
  "/",
  "/readings",
  "/visual-preview",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
] as const;

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string>();

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
            {links.map(([label, href, glyph]) => (
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
          <button
            className="site-sign-out"
            onClick={async () => {
              setSignOutError(undefined);
              const response = await fetch("/api/auth", { method: "DELETE" });
              if (!response.ok) {
                const payload = (await response.json()) as { error?: string };
                setSignOutError(payload.error ?? "Sign-out failed.");
                return;
              }
              router.push("/");
              router.refresh();
            }}
            type="button"
          >
            Sign out
          </button>
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
