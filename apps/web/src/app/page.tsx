import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-16">
      <nav className="flex items-center justify-between" aria-label="Primary navigation">
        <span className="text-lg tracking-[0.22em] uppercase">StarGuidance</span>
        <Link className="rounded-full border border-white/20 px-4 py-2 text-sm" href="/sign-in">
          Sign in
        </Link>
      </nav>
      <section className="my-auto max-w-3xl py-24">
        <p className="mb-5 text-sm tracking-[0.24em] text-[#d8b56d] uppercase">
          Reflection, held with care
        </p>
        <h1 className="text-5xl leading-[1.04] font-semibold text-balance sm:text-7xl">
          A private profile. A genuinely random draw.
        </h1>
        <p className="mt-7 max-w-2xl text-lg leading-8 text-[#c9bfd4]">
          Your birth profile personalizes how the cards are interpreted—never which cards appear.
          Birth time and birthplace are optional, and missing details are never invented.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            className="rounded-full bg-[#f5efe1] px-6 py-3 font-semibold text-[#171121]"
            href="/onboarding"
          >
            Begin privately
          </Link>
          <Link className="rounded-full border border-white/20 px-6 py-3" href="/readings">
            Explore readings
          </Link>
        </div>
      </section>
      <p className="pb-2 text-sm text-[#9f93ad]">
        Reflective guidance, not medical, legal, financial, or factual prediction.
      </p>
    </main>
  );
}
