import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import "@fontsource-variable/cormorant";
import "@fontsource-variable/cormorant/wght-italic.css";
import "@fontsource-variable/manrope";

import "./globals.css";
import "./motion.css";
import { motionTiming } from "@/lib/motion";
import { SiteMotion } from "./site-motion";
import { SiteAtmosphere } from "./site-atmosphere";
import { AppNav } from "./app-nav";
import { ProductTelemetryBeacon } from "./product-telemetry-beacon";
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
    <html
      lang="en"
      data-motion="reduced"
      style={
        Object.fromEntries(
          Object.entries(motionTiming).map(([key, value]) => [`--motion-${key}`, `${value}ms`]),
        ) as CSSProperties
      }
    >
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
        <SiteMotion>
          <SiteAtmosphere />
          <ProductTelemetryBeacon />
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <AppNav />
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
          <SiteFooter />
        </SiteMotion>
      </body>
    </html>
  );
}
