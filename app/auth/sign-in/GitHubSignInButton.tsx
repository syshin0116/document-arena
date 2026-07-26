"use client";

import { useState } from "react";
import { createAuthClient } from "@neondatabase/auth/next";
import { Button } from "@/components/ui/button";

const authClient = createAuthClient();

export function GitHubSignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);

    const result = await authClient.signIn.social({
      provider: "github",
      callbackURL: "/",
      errorCallbackURL: "/auth/sign-in?error=oauth",
    });

    if (result.error) {
      setError("GitHub sign-in could not be started. Please try again.");
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" size="lg" onClick={signIn} disabled={pending}>
        {pending ? "Opening GitHub…" : "Continue with GitHub"}
      </Button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
