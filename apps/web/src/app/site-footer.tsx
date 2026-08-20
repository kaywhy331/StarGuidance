"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteFooter() {
  const pathname = usePathname();
  const fullscreenExperience =
    pathname === "/readings" ||
    pathname === "/visual-preview" ||
    pathname.startsWith("/session/") ||
    pathname.startsWith("/reading/");

  if (fullscreenExperience) return null;

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <span aria-hidden="true" className="site-footer__star">
            ✦
          </span>
          <p>StarGuidance</p>
          <small>Private reflection. Unaltered cards. Your agency intact.</small>
        </div>
        <nav aria-label="Legal navigation">
          <Link href="/terms">Terms &amp; reading guide</Link>
          <Link href="/privacy">Privacy notice</Link>
        </nav>
      </div>
    </footer>
  );
}
