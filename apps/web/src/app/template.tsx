import type { ReactNode } from "react";

export default function Template({ children }: { children: ReactNode }) {
  return <div className="route-arrival">{children}</div>;
}
