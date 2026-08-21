import Link from "next/link";

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

export default function HomePage() {
  return (
    <main className="home-shell">
      <nav aria-label="Primary navigation" className="home-nav">
        <Brand />
        <Link className="sg-button sg-button--quiet sg-button--compact" href="/sign-in">
          Sign in
        </Link>
      </nav>

      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">
            <span aria-hidden="true">✦</span> A private space for reflection
          </p>
          <h1>
            Your pattern, held gently.
            <span>A genuinely random draw.</span>
          </h1>
          <p className="home-hero__lede">
            A quiet tarot ritual shaped by a private birth profile. Your profile deepens the
            interpretation—never which cards appear.
          </p>
          <div className="home-hero__actions">
            <Link className="sg-button sg-button--primary" href="/sign-up">
              <span>Begin privately</span>
              <span aria-hidden="true">↗</span>
            </Link>
            <Link className="sg-button sg-button--secondary" href="/readings">
              Explore the ritual
            </Link>
          </div>
          <ul aria-label="Privacy commitments" className="home-trust-list">
            <li>
              <span aria-hidden="true">◇</span> Birth time optional
            </li>
            <li>
              <span aria-hidden="true">◇</span> Cards locked before interpretation
            </li>
            <li>
              <span aria-hidden="true">◇</span> Your data stays yours
            </li>
          </ul>
        </div>

        <div aria-label="A three-card reflective spread" className="home-oracle">
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
            <span>Draw integrity</span>
            <small>Question and profile never choose the cards</small>
          </div>
        </div>
      </section>

      <section aria-label="How StarGuidance works" className="home-passage">
        <article>
          <span>01</span>
          <h2>Offer only what you know</h2>
          <p>Name and birth date form the core. Place and time remain entirely optional.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Meet an unaltered draw</h2>
          <p>Secure randomness locks every card and reversal before any interpretation begins.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Leave with something useful</h2>
          <p>Read conditional trajectories, practical agency, and one question to carry forward.</p>
        </article>
      </section>

      <p className="home-disclaimer">
        Reflective guidance for personal inquiry—not medical, legal, financial, or factual
        prediction.
      </p>
    </main>
  );
}
