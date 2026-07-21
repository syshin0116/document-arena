"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SAMPLE_DOCUMENTS } from "../lib/sample-documents-meta";
import {
  listLocalDocuments,
  type LocalDocumentSummary,
} from "../local-document-store";

/**
 * A ⌘K command palette for the actions that are navigation, not parser choice.
 *
 * It is mounted once in the root layout so ⌘K / Ctrl+K works on every surface.
 * Every command here also has a visible control somewhere (the sample shelf, the
 * nav links), per docs/REDESIGN.md's rule that the palette never becomes the
 * only way to reach an action. Parser runs are deliberately absent — those are a
 * workspace decision with their own controls and provenance, not a global jump.
 *
 * A decoupled trigger (a visible ⌘K button in a header) opens it by dispatching
 * `commandpalette:open`, since the trigger lives in a different subtree.
 */

export const OPEN_EVENT = "commandpalette:open";

type Command = {
  id: string;
  label: string;
  hint: string;
  href: string;
  keywords: string;
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [recent, setRecent] = useState<LocalDocumentSummary[]>([]);

  // The device-local workspaces, so ⌘K can resume work from any surface. Read on
  // mount and re-read each time the palette opens, since another tab or an
  // upload may have changed the store.
  const loadRecent = useCallback(() => {
    listLocalDocuments()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const commands = useMemo<Command[]>(() => {
    const workspaces = recent.map((d) => ({
      id: `recent-${d.id}`,
      label: `Open · ${d.name}`,
      hint: "recent",
      href: `/documents/${d.id}`,
      keywords: `${d.name} workspace recent resume`,
    }));
    const samples = SAMPLE_DOCUMENTS.map((s) => ({
      id: `sample-${s.id}`,
      label: `Open sample · ${s.shortTitle}`,
      hint: "sample",
      href: `/documents/${s.id}`,
      keywords: `${s.title} ${s.shortTitle} sample document parse`,
    }));
    return [
      ...workspaces,
      ...samples,
      { id: "arena", label: "Start a blind battle", hint: "arena", href: "/arena", keywords: "arena blind vote compare battle" },
      { id: "standings", label: "View standings", hint: "go", href: "/leaderboard", keywords: "standings leaderboard votes ranking" },
      { id: "design", label: "Design tokens", hint: "go", href: "/design", keywords: "design tokens colours type reference" },
      { id: "home", label: "Upload a PDF", hint: "go", href: "/", keywords: "home upload open pdf document" },
    ];
  }, [recent]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q),
    );
  }, [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    const target = returnFocus.current;
    returnFocus.current = null;
    // Restore focus to whatever opened the palette.
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  }, []);

  const openPalette = useCallback(() => {
    returnFocus.current = (document.activeElement as HTMLElement) ?? null;
    setQuery("");
    setSelected(0);
    setOpen(true);
  }, []);

  const run = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      setOpen(false);
      returnFocus.current = null;
      router.push(command.href);
    },
    [router],
  );

  // Global open shortcut + the decoupled trigger event.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => {
          if (current) return false;
          returnFocus.current = (document.activeElement as HTMLElement) ?? null;
          setQuery("");
          setSelected(0);
          return true;
        });
      }
    };
    const onOpenEvent = () => openPalette();
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, [openPalette]);

  // Focus the input on open; refresh the workspace list; lock body scroll.
  useEffect(() => {
    if (!open) return;
    loadRecent();
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, loadRecent]);

  if (!open) return null;

  // Clamp at render rather than in an effect: filtering can shrink the list
  // below the stored index, and deriving the active row keeps it always valid
  // without a cascading setState.
  const activeIndex = results.length ? Math.min(selected, results.length - 1) : 0;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(results[activeIndex]);
    }
  };

  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          placeholder="Open a sample, jump to the arena or standings…"
          aria-label="Search commands"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
        />
        <ul className="cmdk-list" role="listbox" aria-label="Commands">
          {results.length === 0 && (
            <li className="cmdk-empty">
              Nothing matches “{query}”.
            </li>
          )}
          {results.map((command, index) => (
            <li
              key={command.id}
              role="option"
              aria-selected={index === activeIndex}
              className="cmdk-item"
              onMouseEnter={() => setSelected(index)}
              onClick={() => run(command)}
            >
              <span className="cmdk-item-label">{command.label}</span>
              <span className="cmdk-item-hint">{command.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
