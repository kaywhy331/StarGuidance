import { safeAccountReturnPath } from "@/lib/account-return";

import { ConsentClient } from "./consent-client";

export const metadata = { title: "Terms and privacy" };

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  return <ConsentClient nextPath={safeAccountReturnPath(params.next)} />;
}
