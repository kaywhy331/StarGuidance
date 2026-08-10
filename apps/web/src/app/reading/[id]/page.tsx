import { ReadingResultScene } from "./reading-result-scene";

export default async function ReadingResultPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReadingResultScene readingId={(await params).id} />;
}
