import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";

import { ReadingResultScene } from "./reading-result-scene";

export default async function ReadingResultPage({ params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  return (
    <ReadingResultScene
      {...(user.settings ? { initialPreferences: user.settings } : {})}
      readingId={(await params).id}
    />
  );
}
