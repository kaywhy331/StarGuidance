import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { SiteAtmosphere } from "./site-atmosphere";
import { AppNav } from "./app-nav";
import { SiteFooter } from "./site-footer";

export const metadata: Metadata = {
  title: {
    default: "StarGuidance",
    template: "%s · StarGuidance",
  },
  description: "Private profile insight. A genuinely random tarot draw.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const suppressHostPreviewDrawer =
    process.env.APP_ENV === "staging" ||
    process.env.APP_ENV === "test" ||
    process.env.ENABLE_VISUAL_PREVIEW === "true";

  return (
    <html lang="en">
      <head>
        {suppressHostPreviewDrawer && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                'try { window.sessionStorage.setItem("ntl-drawer-initial-state", "hidden"); } catch {}',
            }}
            id="suppress-netlify-preview-drawer"
          />
        )}
      </head>
      <body>
        <SiteAtmosphere />
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AppNav />
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
