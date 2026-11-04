import { LoadingState } from "@starguidance/design-system";

export default function Loading() {
  return (
    <main aria-busy="true" className="route-loading">
      <LoadingState label="Opening your space…" />
    </main>
  );
}
