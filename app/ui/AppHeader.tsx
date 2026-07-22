import type { ReactNode } from "react";
import Link from "next/link";
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
        {/* No back arrow: the wordmark beside it already links home, so the
            arrow was a second control to the same place. */}
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
