import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { AppNav } from "./app-nav";

export const metadata: Metadata = {
  title: "StarGuidance",
  description: "Private profile insight. A genuinely random tarot draw.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AppNav />
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
