import { redirect } from "next/navigation";

import { requireOperationalRole } from "@/lib/operational-access";

import { OperationsConsole } from "./operations-console";

export default async function OperationsPage() {
  let role: "support" | "operator";
  try {
    role = (await requireOperationalRole("support")).operationalRole;
  } catch {
    redirect("/");
  }
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <p className="text-sm tracking-[.18em] text-[#d8b56d] uppercase">Restricted operations</p>
      <h1 className="mt-2 text-5xl font-semibold">Support and recovery</h1>
      <p className="mt-4 max-w-3xl text-[#b8adc8]">
        Role: {role}. This surface exposes only masked status and narrowly guarded failed-job retry.
        Every mutation is rate-limited and audited.
      </p>
      <OperationsConsole role={role} />
    </main>
  );
}
