"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@starguidance/design-system";

export function LocalSignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  return (
    <form
      className="mt-8 grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(undefined);
        const email = new FormData(event.currentTarget).get("email");
        const response = await fetch("/api/auth/local", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!response.ok) return setError("Enter a valid email for the local session.");
        router.push("/onboarding");
        router.refresh();
      }}
    >
      <Field autoComplete="email" error={error} label="Email" name="email" required type="email" />
      <Button type="submit">Continue privately</Button>
    </form>
  );
}
