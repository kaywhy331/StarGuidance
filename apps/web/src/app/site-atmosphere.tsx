/**
 * A shared, CSS-only atmosphere keeps product routes in the same visual world
 * as the reading sanctuary without adding image requests or client-side work.
 */
export function SiteAtmosphere() {
  return (
    <div aria-hidden="true" className="site-atmosphere">
      <div className="site-atmosphere__aurora" />
      <div className="site-atmosphere__stars" />
      <div className="site-atmosphere__orbit site-atmosphere__orbit--near" />
      <div className="site-atmosphere__orbit site-atmosphere__orbit--far" />
      <div className="site-atmosphere__grain" />
    </div>
  );
}
