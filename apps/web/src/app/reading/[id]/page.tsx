import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { readingAudioAvailable } from "@/lib/reading-audio";
import { getRuntimeConfiguration } from "@/lib/runtime-configuration";

import { ReadingResultScene } from "./reading-result-scene";

export default async function ReadingResultPage({ params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  const runtimeConfiguration = await getRuntimeConfiguration();
  return (
    <ReadingResultScene
      audioAvailable={readingAudioAvailable()}
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
