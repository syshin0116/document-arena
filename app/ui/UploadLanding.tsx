"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { saveLocalDocument } from "../local-document-store";
import { Brand } from "./Brand";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export function UploadLanding() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function openWorkspace(file: File) {
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Choose a PDF file to start a workspace.");
      return;
    }
    if (file.size === 0) {
      setError("This PDF is empty.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("This PDF is larger than the 50 MB prototype limit.");
      return;
    }

    setError(null);
    setPreparing(true);
    try {
      const document = await saveLocalDocument(file);
      window.location.assign(`/documents/${document.id}`);
    } catch {
      setError(
        "This browser could not save the local PDF. Check available storage and try again.",
      );
      setPreparing(false);
    }
  }

  return (
    <main className="landing-shell">
      <header className="landing-header">
        <Brand />
        <nav className="landing-nav" aria-label="Product surfaces">
          <Link className="quiet-button landing-secondary-link" href="/arena">
            Arena
          </Link>
          <Link className="quiet-button landing-secondary-link" href="/leaderboard">
            Leaderboard
          </Link>
          <Link className="quiet-button landing-connections-link" href="/settings/connections">
            Connections
          </Link>
          <Link className="quiet-button landing-demo-link" href="/documents/demo">
            Open demo
            <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>

      <section className="landing-main" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" />
            Open parser workbench
          </p>
          <h1 id="landing-title">See what your parser actually saw.</h1>
          <p className="landing-lede">
            Upload once, inspect every result beside the source, and compare a
            second parser only when you need it.
          </p>
        </div>

        <div
          className="upload-card"
          data-dragging={dragging || undefined}
          aria-busy={preparing}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files.item(0);
            if (file) void openWorkspace(file);
          }}
        >
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Choose a PDF document"
            disabled={preparing}
            onChange={(event) => {
              const file = event.target.files?.item(0);
              if (file) void openWorkspace(file);
            }}
          />
          <div className="upload-document" aria-hidden="true">
            <span className="upload-document-fold" />
            <span />
            <span />
            <span />
          </div>
          <div className="upload-copy">
            <h2>Drop a PDF here</h2>
            <p>or choose one from your device</p>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={preparing}
            onClick={() => inputRef.current?.click()}
          >
            {preparing ? "Preparing workspace…" : "Choose PDF"}
          </button>
          <p className="upload-limits">PDF only · up to 50 MB</p>
          {error && (
            <p className="upload-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="privacy-note">
          <span className="privacy-lock" aria-hidden="true" />
          <span>
            Local previews stay in this browser. Blind-battle votes stay on this
            device too.
          </span>
        </div>
      </section>

      <section className="landing-proof" aria-label="Key capabilities">
        <article>
          <span className="proof-index">01</span>
          <div>
            <h2>Trace the evidence</h2>
            <p>Native bounding boxes link source regions to parsed blocks.</p>
          </div>
        </article>
        <article>
          <span className="proof-index">02</span>
          <div>
            <h2>Compare in context</h2>
            <p>Two parser results stay synchronized to the same source page.</p>
          </div>
        </article>
        <article>
          <span className="proof-index">03</span>
          <div>
            <h2>Reproduce every run</h2>
            <p>Raw outputs, versions, options, and timing remain inspectable.</p>
          </div>
        </article>
      </section>
    </main>
  );
}
