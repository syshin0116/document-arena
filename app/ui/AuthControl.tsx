"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createAuthClient } from "@neondatabase/auth/next";
import { LogIn, LogOut } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SessionProjection = Readonly<{
  configured: boolean;
  authenticated: boolean;
  identity: Readonly<{
    subject: string;
    name: string | null;
    email: string | null;
  }> | null;
}>;

const authClient = createAuthClient();

export function AuthControl() {
  const [session, setSession] = useState<SessionProjection | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/v1/auth/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 503) return null;
        if (!response.ok) throw new Error("Session lookup failed.");
        return (await response.json()) as SessionProjection;
      })
      .then(setSession)
      .catch(() => setSession(null));

    return () => controller.abort();
  }, []);

  if (!session?.configured) return null;

  if (!session.authenticated) {
    return (
      <Link
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        href="/auth/sign-in"
      >
        <LogIn aria-hidden="true" />
        Sign in
      </Link>
    );
  }

  const label =
    session.identity?.name ?? session.identity?.email ?? "Signed in";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={label}
      onClick={async () => {
        await authClient.signOut();
        window.location.assign("/");
      }}
    >
      <LogOut aria-hidden="true" />
      Sign out
    </Button>
  );
}
