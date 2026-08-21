"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import {
  emitBrowserProductEventOnce,
  type BrowserProductEventName,
} from "@/lib/product-telemetry-client";

const routeEvents: ReadonlyArray<{
  matches: (path: string) => boolean;
  name: BrowserProductEventName;
  routeClass: "landing" | "signup" | "onboarding" | "profile";
}> = [
  { matches: (path) => path === "/", name: "landing_view", routeClass: "landing" },
  { matches: (path) => path === "/sign-up", name: "signup_started", routeClass: "signup" },
  { matches: (path) => path === "/onboarding", name: "profile_started", routeClass: "onboarding" },
  { matches: (path) => path === "/profile", name: "report_previewed", routeClass: "profile" },
];

function deviceClass(): "mobile" | "tablet" | "desktop" {
  if (window.innerWidth < 640) return "mobile";
  if (window.innerWidth < 1024) return "tablet";
  return "desktop";
}

function normalizedLocale(): string | undefined {
  const match = navigator.language.match(/^([a-z]{2,3})(?:-([A-Za-z]{2}))?/);
  if (!match?.[1]) return undefined;
  return match[2] ? `${match[1].toLowerCase()}-${match[2].toUpperCase()}` : match[1].toLowerCase();
}

function referrerClass(): "direct" | "internal" | "external" {
  if (!document.referrer) return "direct";
  try {
    return new URL(document.referrer).origin === window.location.origin ? "internal" : "external";
  } catch {
    return "external";
  }
}

export function ProductTelemetryBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const locale = normalizedLocale();
    for (const routeEvent of routeEvents.filter(({ matches }) => matches(pathname))) {
      emitBrowserProductEventOnce(routeEvent.name, pathname, {
        routeClass: routeEvent.routeClass,
        deviceClass: deviceClass(),
        referrerClass: referrerClass(),
        ...(locale ? { locale } : {}),
      });
    }
  }, [pathname]);

  return null;
}
