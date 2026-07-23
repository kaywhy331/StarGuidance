export function AtmosphericLayers({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`atmospheric-layers ${reducedMotion ? "atmosphere-still" : ""}`}
    >
      <div className="sanctuary-light" />
      <div className="sanctuary-sigil sanctuary-sigil-left" />
      <div className="sanctuary-sigil sanctuary-sigil-right" />
      <div className="mist mist-far" />
      <div className="mist mist-near" />
      <div className="sanctuary-particles">
        {Array.from({ length: 14 }, (_, index) => (
          <i key={index} style={{ "--particle-index": index } as React.CSSProperties} />
        ))}
      </div>
      <div className="sanctuary-vignette" />
    </div>
  );
}
