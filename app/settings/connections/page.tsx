import type { Metadata } from "next";
import { ConnectionSettings } from "../../ui/ConnectionSettings";

export const metadata: Metadata = {
  title: "Connections · Document Arena",
  description: "Configure private provider connections on the local runner.",
};

function safeReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/";
  return /^\/documents\/[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "/";
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  return <ConnectionSettings returnTo={safeReturnTo(returnTo)} />;
}
