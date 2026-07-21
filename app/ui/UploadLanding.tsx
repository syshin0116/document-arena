"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, FileText, LockKeyhole } from "lucide-react";
import { m } from "motion/react";
import {
  listLocalDocuments,
  saveLocalDocument,
  type LocalDocumentSummary,
} from "../local-document-store";
import {
  SAMPLE_DOCUMENTS,
} from "../lib/sample-documents-meta";
import { buttonVariants } from "@/components/ui/button";
import {
  Dropzone,
  DropZoneArea,
  DropzoneDescription,
  DropzoneMessage,
  DropzoneTrigger,
  useDropzone,
} from "@/components/ui/dropzone";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { motionTransition } from "@/lib/motion";
import { ModeToggle } from "@/components/mode-toggle";
import { Brand } from "./Brand";
import { OPEN_EVENT } from "./CommandPalette";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const RECENT_SHELF_LIMIT = 3;

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UploadLanding() {
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Recent workspaces are device-local, so they can only be read after mount.
  // Until then the shelf renders nothing rather than a placeholder, because a
  // first-time visitor has none and should not be shown an empty frame.
  const [recent, setRecent] = useState<LocalDocumentSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listLocalDocuments().then((documents) => {
      if (!cancelled) setRecent(documents);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dropzone = useDropzone<{ documentId: string }, string>({
    validation: {
      accept: { "application/pdf": [".pdf"] },
      minSize: 1,
      maxSize: MAX_FILE_SIZE,
      maxFiles: 1,
    },
    onRootError: (message) => setError(message ?? null),
    onDropFile: async (file) => {
      setError(null);
      setPreparing(true);
      try {
        const document = await saveLocalDocument(file);
        window.location.assign(`/documents/${document.id}`);
        return { status: "success", result: { documentId: document.id } };
      } catch {
        const message =
          "This browser could not save the local PDF. Check available storage and try again.";
        setError(message);
        setPreparing(false);
        return { status: "error", error: message };
      }
    },
  });

  /* docs/PAGES.md asks for a sample document and a device-local recent list on
     this page; neither had been built, so a visitor with no PDF to hand had
     nothing to try and a returning one had no way back. The recent list is
     capped: it is a way back to work in progress, not an archive, and an
     uncapped one pushed the drop zone's own column off the fold. */
  /* The samples sit under the drop zone, not beside it: "no PDF handy?" is the
     alternative to the thing directly above it, and reads as one decision. */
  const sampleShelf = (
    <div className="landing-shelves sample-shelf">
      {/* Thumbnails, because the choice between these three is a choice about
          what the document looks like. The descriptors are block counts from
          each document's real parse, so the shelf answers "which one will
          stress the parser I care about" rather than just naming papers. */}
      <section aria-labelledby="sample-heading">
        <h2 id="sample-heading" className="landing-shelf-heading">
          No PDF handy?
        </h2>
        <ul className="sample-grid">
          {SAMPLE_DOCUMENTS.map((sample) => (
            <li key={sample.id}>
              <Link
                className="sample-card"
                href={`/documents/${sample.id}`}
                title={sample.title}
              >
                {/* A plain <img>, not next/image. These are already the exact
                    size they render at (320px wide, 17-29 KB), so the optimizer
                    has nothing to save, and it routes them through
                    /_next/image?url=...&w=...&q=... - a query-string image
                    proxy that content blockers drop. Arc blocks it and the
                    shelf renders empty; Chrome does not. Serving the static
                    file removes the failure mode along with the hop. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="sample-thumb"
                  src={sample.thumbnailPath}
                  alt={`First page of ${sample.title}`}
                  width={320}
                  height={414}
                  loading="lazy"
                  decoding="async"
                />
                <span className="sample-name">{sample.shortTitle}</span>
                <span className="sample-meta">
                  {sample.pageCount} pages · {sample.descriptor}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  const recentShelf = recent.length > 0 && (
    <div className="landing-shelves recent-shelf">
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="landing-shelf-heading">
            Recent workspaces
          </h2>
          <ItemGroup>
            {recent.slice(0, RECENT_SHELF_LIMIT).map((document) => (
              <Item
                key={document.id}
                size="sm"
                render={<Link href={`/documents/${document.id}`} />}
              >
                <ItemMedia variant="icon">
                  <Clock />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{document.name}</ItemTitle>
                  <ItemDescription>{formatSize(document.size)}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ArrowRight />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </section>
    </div>
  );

  return (
    <m.main
      className="landing-shell landing-shell-v2"
      initial={false}
      animate={{ opacity: 1 }}
      transition={motionTransition.enter}
    >
      <header className="landing-header">
        <Link className="brand-home-link" href="/" aria-label="Document Arena home">
          <Brand />
        </Link>
        {/* Arena and standings used to be reachable only from inside a
            document workspace, so a first visit gave no sign that blind
            comparison exists at all. They are navigation, not a decision the
            upload flow asks the visitor to make, so the page can name them
            without taking on the parser choice this page still keeps out. */}
        <nav className="landing-nav landing-nav-v2" aria-label="Product surfaces">
          <button
            type="button"
            className="cmdk-trigger"
            onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
            aria-haspopup="dialog"
            aria-label="Open command palette"
          >
            Search <kbd>⌘K</kbd>
          </button>
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href="/arena"
          >
            Arena
          </Link>
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href="/leaderboard"
          >
            Leaderboard
          </Link>
          <ModeToggle />
        </nav>
      </header>

      <section className="landing-main" aria-labelledby="landing-title">
        {/* The copy and the shelves share one grid cell. As separate cells the
            shelves landed in row 2, whose top edge is set by the drop zone
            opposite, which opened a 160px hole under the lede. */}
        <div className="landing-intro">
          <m.div
            className="landing-copy"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTransition.enter}
          >
            <p className="landing-kicker landing-kicker-eyebrow">
              <span className="landing-kicker-tick" aria-hidden="true" />
              Evidence-first document review
            </p>
            <h1 id="landing-title">Parse it. Then prove every block.</h1>
            <p className="landing-lede">
              Open a PDF and read the parser&apos;s output beside the exact
              region of the page it came from. When two parsers disagree, the
              page shows you where.
            </p>
          </m.div>

          {recentShelf}
        </div>

        <m.div
          className="upload-card-wrap"
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionTransition.enter, delay: 0.06 }}
        >
          <Dropzone {...dropzone}>
            <DropZoneArea className="upload-card" aria-busy={preparing}>
              <div className="upload-icon" aria-hidden="true">
                <FileText />
              </div>
              <div className="upload-copy">
                <h2>{preparing ? "Preparing your workspace" : "Bring your PDF into focus"}</h2>
                <DropzoneDescription>
                  One document, up to 50 MB. Nothing is uploaded yet.
                </DropzoneDescription>
              </div>
              <DropzoneTrigger
                aria-label="Choose a PDF document"
                className={cn(buttonVariants({ size: "lg" }), "upload-trigger")}
              >
                {preparing ? "Preparing…" : "Choose PDF"}
                {!preparing && <ArrowRight data-icon="inline-end" />}
              </DropzoneTrigger>
              <DropzoneMessage className="upload-error">
                {error ?? ""}
              </DropzoneMessage>
            </DropZoneArea>
          </Dropzone>

          {/* Belongs to the drop zone, so it sits in the drop zone's cell. As
              its own grid row it was pushed 244px clear of the box it
              qualifies, next to nothing at all. */}
          <div className="privacy-note">
            <LockKeyhole aria-hidden="true" />
            <span>
              Saved only in this browser. We ask before any hosted or external
              parser transfer.
            </span>
          </div>

          {sampleShelf}
        </m.div>

      </section>

      {/* A look at the thing the copy promises. The landing is the functional
          bench, not a marketing page, so this is one honest screenshot of a
          real parse - the source page beside the blocks read from it - not a
          feature grid. It teaches "evidence-first" to a first visit that has
          never opened a workspace. */}
      <section className="landing-teaser" aria-label="What a parsed document looks like">
        <figure className="teaser-frame">
          <figcaption className="teaser-caption">
            <span className="teaser-caption-dot" aria-hidden="true" />
            Every block, beside the region it was read from
          </figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="teaser-shot"
            src="/teaser/workspace-evidence.webp"
            alt="A workspace: a paper's first page on the left, and a parser's blocks on the right, each labelled with its kind and word count."
            width={1400}
            height={707}
            loading="lazy"
            decoding="async"
          />
        </figure>
      </section>
    </m.main>
  );
}
