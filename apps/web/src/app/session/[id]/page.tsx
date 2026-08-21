import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getRuntimeConfiguration } from "@/lib/runtime-configuration";

import { ReadingScene } from "./reading-scene";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  const runtimeConfiguration = await getRuntimeConfiguration();
  return (
    <ReadingScene
      animationVariant={
        runtimeConfiguration.features.animationsEnabled
          ? runtimeConfiguration.features.animationVariant
          : "disabled"
      }
      {...(user.settings ? { initialPreferences: user.settings } : {})}
      readingId={(await params).id}
    />
  );
}
