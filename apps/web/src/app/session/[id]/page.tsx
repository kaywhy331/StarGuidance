import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";

import { ReadingScene } from "./reading-scene";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  return (
    <ReadingScene
      {...(user.settings ? { initialPreferences: user.settings } : {})}
      readingId={(await params).id}
    />
  );
}
