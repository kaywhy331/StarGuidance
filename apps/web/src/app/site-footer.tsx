import Link from "next/link";

/**
 * Present on every page, so the standing terms are always one click away.
 *
 * A reading no longer explains what tarot is and is not; that statement lives
 * here instead of interrupting the reading itself.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 px-6 py-6 text-sm text-[#8f86a0]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2">
        <span>StarGuidance — tarot readings for reflection and entertainment.</span>
        <Link className="ml-auto underline" href="/terms">
          Terms &amp; how to read a reading
        </Link>
        <Link className="underline" href="/settings/privacy">
          Privacy
        </Link>
      </div>
    </footer>
  );
}
