"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  ["Read", "/readings"],
  ["History", "/history"],
  ["Profile", "/profile"],
  ["Privacy", "/settings/privacy"],
] as const;

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  if (
    pathname === "/" ||
    pathname === "/readings" ||
    pathname === "/visual-preview" ||
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/session/")
  )
    return null;
  return (
    <header className="border-b border-white/10 bg-[#090713]/80 backdrop-blur">
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-4"
      >
        <Link
          className="mr-auto min-w-0 tracking-[0.18em] [overflow-wrap:anywhere] uppercase"
          href="/"
        >
          StarGuidance
        </Link>
        {links.map(([label, href]) => (
          <Link
            aria-current={pathname.startsWith(href) ? "page" : undefined}
            href={href}
            key={href}
          >
            {label}
          </Link>
        ))}
        <button
          className="rounded-full border border-white/15 px-3 py-1.5 text-sm"
          onClick={async () => {
            await fetch("/api/auth", { method: "DELETE" });
            router.push("/");
            router.refresh();
          }}
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}
