import { ReadingScene } from "./reading-scene";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReadingScene readingId={(await params).id} />;
}
