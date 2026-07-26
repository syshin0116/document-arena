import type { Metadata } from "next";
import Link from "next/link";
import { resolveNeonAuthConfiguration } from "@/lib/auth/config";
import { Brand } from "@/app/ui/Brand";
import { GitHubSignInButton } from "./GitHubSignInButton";

export const metadata: Metadata = {
  title: "Sign in · Document Arena",
};

export default function SignInPage() {
  const configuration = resolveNeonAuthConfiguration();

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link href="/" aria-label="Document Arena home">
          <Brand />
        </Link>
        <div>
          <p className="landing-kicker landing-kicker-eyebrow">
            Hosted execution
          </p>
          <h1 id="auth-title">Sign in only when the work leaves this device.</h1>
          <p>
            Local documents and parser history stay available without an
            account. Sign-in will be required only for hosted, cost-bearing
            runs.
          </p>
        </div>
        {configuration.configured ? (
          <GitHubSignInButton />
        ) : (
          <p className="auth-unavailable" role="status">
            Hosted authentication is not configured in this environment.
          </p>
        )}
        <Link className="auth-back-link" href="/">
          Continue with local documents
        </Link>
      </section>
    </main>
  );
}
