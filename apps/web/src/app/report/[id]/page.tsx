import { ReportView } from "./report-view";
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReportView reportId={(await params).id} />;
}
