import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Brand } from "./Brand";

export function AppHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-header app-header">
      <div className="workspace-identity">
        <Link
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "back-button")}
          href="/"
          aria-label="Back to upload"
        >
          <ArrowLeft />
        </Link>
        <Link className="workspace-brand" href="/" aria-label="Document Arena home">
          <Brand compact />
        </Link>
        <span className="header-separator" aria-hidden="true" />
        <div className="document-identity">
          <strong>{title}</strong>
          {meta && <span>{meta}</span>}
        </div>
      </div>
      <div className="workspace-actions">{actions}</div>
    </header>
  );
}
