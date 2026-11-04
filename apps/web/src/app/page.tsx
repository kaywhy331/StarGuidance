import Link from "next/link";
import { hasSessionHint } from "./session-hint";
import { HeroDepth, MotionReveal } from "./site-motion";

const previewCards = [
  { label: "The threshold", glyph: "✦", rotation: "home-card--left" },
  { label: "The mirror", glyph: "☾", rotation: "home-card--center" },
  { label: "The way through", glyph: "↟", rotation: "home-card--right" },
] as const;

function Brand() {
  return (
    <span className="site-brand">
      <span aria-hidden="true" className="site-brand__mark">
        <i />
      </span>
      <span>StarGuidance</span>
    </span>
  );
}

export default async function HomePage() {
  const signedIn = await hasSessionHint();
  return (
    <main className="home-shell">
      <nav aria-label="Primary navigation" className="home-nav">
        <Brand />
        <div className="home-nav__actions">
          {signedIn ? (
            <Link className="sg-button sg-button--quiet sg-button--compact" href="/readings">
              Your readings
            </Link>
          ) : (
            <Link className="sg-button sg-button--quiet sg-button--compact" href="/sign-in">
              Sign in
            </Link>
          )}
        </div>
      </nav>

      <section className="home-hero">
        <MotionReveal className="home-hero__copy">
          <p className="eyebrow">
            <span aria-hidden="true">✦</span> A private space for reflection
          </p>
          <h1>
            Your pattern, held gently.
            <span>A reading that meets you where you are.</span>
          </h1>
          <p className="home-hero__lede">
            Bring what&apos;s on your mind. The cards answer, read in light of your birthday, so the
            reading speaks to you rather than to anyone. It is a calm place to think things through,
            not a forecast to obey.
          </p>
          <div className="home-hero__actions">
            {signedIn ? (
              <>
                <Link className="sg-button sg-button--primary" href="/readings">
                  <span>Continue to your readings</span>
                  <span aria-hidden="true">→</span>
                </Link>
                <Link className="sg-button sg-button--secondary" href="/history">
                  History
                </Link>
              </>
            ) : (
              <>
                <Link className="sg-button sg-button--primary" href="/free-reading">
                  <span>Free Reading</span>
                  <span aria-hidden="true">→</span>
                </Link>
                <Link className="sg-button sg-button--secondary" href="/sign-up">
                  Sign up
                </Link>
              </>
            )}
          </div>
          <p className="home-hero__trust">
            The cards fall as they fall — nothing you share can steer them.
          </p>
          <ul aria-label="What to expect" className="home-trust-list">
            <li>
              <span aria-hidden="true">◇</span> Birth time optional
            </li>
            <li>
              <span aria-hidden="true">◇</span> First reading free, no account
            </li>
            <li>
              <span aria-hidden="true">◇</span> Your details stay private
            </li>
          </ul>
        </MotionReveal>

        <HeroDepth>
          <div aria-hidden="true" className="home-oracle__halo" />
          <p className="home-oracle__whisper">A moment to notice what is already moving</p>
          <div className="home-card-stage">
            {previewCards.map((card, index) => (
              <div className={`home-card ${card.rotation}`} key={card.label}>
                <span className="home-card__number">0{index + 1}</span>
                <span aria-hidden="true" className="home-card__glyph">
                  {card.glyph}
                </span>
                <span className="home-card__label">{card.label}</span>
              </div>
            ))}
          </div>
          <div className="home-oracle__seal">
            <span aria-hidden="true">✦</span>
            <span>Held privately</span>
            <small>Your question and your details stay yours</small>
          </div>
        </HeroDepth>
      </section>

      <section aria-label="How StarGuidance works" className="home-passage">
        <MotionReveal>
          <article>
            <span>01</span>
            <h2>Bring your question</h2>
            <p>
              Ask about whatever is on your mind and share your birthday. Your first reading is
              free, with no account needed.
            </p>
          </article>
        </MotionReveal>
        <MotionReveal>
          <article>
            <span>02</span>
            <h2>Meet your cards</h2>
            <p>
              Each card is read with your pattern in mind: what it shows about where you stand, and
              one gentle way forward.
            </p>
          </article>
        </MotionReveal>
        <MotionReveal>
          <article>
            <span>03</span>
            <h2>Continue only if it helps</h2>
            <p>
              Sign up to ask the same cards a follow-up, keep your readings, and let a private
              profile deepen the ones to come.
            </p>
          </article>
        </MotionReveal>
      </section>

      <p className="home-disclaimer">
        Reflective guidance for personal inquiry—not medical, legal, financial, or factual
        prediction.
      </p>
    </main>
  );
}
