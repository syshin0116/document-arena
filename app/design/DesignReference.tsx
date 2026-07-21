"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import { Brand } from "../ui/Brand";
import "./design.css";

/**
 * A living reference for the project's design tokens.
 *
 * It reads the *computed* value of every token from the document at runtime
 * rather than hard-coding it, so it can never drift from app/globals.css and it
 * updates live when the theme toggles. The token lists below are curated for
 * reading order; the values are always the real ones.
 */

type Swatch = { name: string; note?: string };

const SURFACES: Swatch[] = [
  { name: "--canvas", note: "page ground" },
  { name: "--canvas-deep", note: "recessed ground" },
  { name: "--surface", note: "panels, cards" },
  { name: "--surface-subtle", note: "toolbars, wells" },
  { name: "--surface-raised", note: "sticky heads (α)" },
  { name: "--surface-overlay", note: "sheets, popovers (α)" },
];

const INK: Swatch[] = [
  { name: "--ink", note: "primary text" },
  { name: "--ink-soft", note: "body / secondary" },
  { name: "--ink-faint", note: "metadata" },
  { name: "--line", note: "hairlines" },
  { name: "--line-strong", note: "pane dividers" },
];

const CANDIDATES: Swatch[] = [
  { name: "--candidate-1", note: "A · indigo" },
  { name: "--candidate-1-deep" },
  { name: "--candidate-1-soft" },
  { name: "--candidate-2", note: "B · teal" },
  { name: "--candidate-2-deep" },
  { name: "--candidate-2-soft" },
  { name: "--candidate-3", note: "C · crimson" },
  { name: "--candidate-3-deep" },
  { name: "--candidate-3-soft" },
  { name: "--candidate-blind", note: "blind mode" },
];

const ACCENTS: Swatch[] = [
  { name: "--indigo", note: "accent" },
  { name: "--indigo-dark" },
  { name: "--indigo-soft" },
  { name: "--amber", note: "derived / warn" },
  { name: "--success" },
  { name: "--danger" },
  { name: "--focus", note: "focus ring (themed)" },
];

const STATE_SURFACES: Swatch[] = [
  { name: "--surface-accent" },
  { name: "--surface-warning" },
  { name: "--surface-danger" },
  { name: "--line-warning" },
];

const TYPE_STEPS = [
  { name: "--text-2xs", role: "mono labels · absolute floor" },
  { name: "--text-xs", role: "column-head stats" },
  { name: "--text-sm", role: "UI default" },
  { name: "--text-base", role: "parsed body" },
  { name: "--text-lg", role: "block headings" },
  { name: "--text-xl", role: "surface titles" },
  { name: "--text-2xl", role: "display" },
  { name: "--text-3xl", role: "landing / standings h1" },
];

const WEIGHTS = [
  { w: 400, label: "Regular" },
  { w: 500, label: "Medium" },
  { w: 600, label: "Semibold" },
  { w: 700, label: "Bold" },
];

const RADII = ["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-2xl", "--radius-full"];

const SHADOWS = ["--shadow-small", "--shadow-large"];

const DURATIONS = ["--motion-fast", "--motion-normal", "--motion-slow"];
const EASINGS = ["--ease-standard", "--ease-drawer"];

const CHROME = ["--shell-head", "--pane-head", "--bar-h", "--row-h"];

const EVIDENCE = [
  "--evidence-rest-alpha",
  "--evidence-rest-fill",
  "--evidence-native",
  "--evidence-derived",
];

function useComputed(names: string[]) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const n of names) next[n] = cs.getPropertyValue(n).trim();
      setValues(next);
    };
    read();
    // Re-read when the theme class flips.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join(",")]);
  return values;
}

function ColorGrid({ swatches }: { swatches: Swatch[] }) {
  const values = useComputed(swatches.map((s) => s.name));
  return (
    <div className="dref-swatches">
      {swatches.map((s) => (
        <div key={s.name} className="dref-swatch">
          <span className="dref-chip" style={{ background: `var(${s.name})` }} />
          <div className="dref-swatch-meta">
            <code>{s.name}</code>
            {s.note && <span className="dref-note">{s.note}</span>}
            <span className="dref-value">{values[s.name] || "—"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DesignReference() {
  const typeValues = useComputed(TYPE_STEPS.map((t) => t.name));
  const radiiValues = useComputed(RADII);
  const shadowValues = useComputed(SHADOWS);
  const durationValues = useComputed([...DURATIONS, ...EASINGS]);
  const chromeValues = useComputed(CHROME);
  const evidenceValues = useComputed(EVIDENCE);

  return (
    <main className="dref">
      <header className="dref-header">
        <Link className="brand-home-link" href="/" aria-label="Document Arena home">
          <Brand />
        </Link>
        <div className="dref-header-right">
          <span className="dref-header-label">Design tokens</span>
          <ModeToggle />
        </div>
      </header>

      <div className="dref-body">
        <p className="dref-lede">
          Every token below is read from the running stylesheet, so it always
          matches <code>app/globals.css</code>. Toggle the theme to watch the
          colours re-resolve. Source of truth: the <code>:root</code> and{" "}
          <code>.dark</code> blocks.
        </p>

        <section className="dref-section">
          <h2>Surfaces</h2>
          <ColorGrid swatches={SURFACES} />
        </section>

        <section className="dref-section">
          <h2>Ink &amp; lines</h2>
          <ColorGrid swatches={INK} />
        </section>

        <section className="dref-section">
          <h2>Candidate hues</h2>
          <p className="dref-section-note">
            Equal-luminance by construction — one L, one C per theme, hue only
            varies — so no candidate reads louder than another.
          </p>
          <ColorGrid swatches={CANDIDATES} />
        </section>

        <section className="dref-section">
          <h2>Accent &amp; status</h2>
          <ColorGrid swatches={ACCENTS} />
          <ColorGrid swatches={STATE_SURFACES} />
        </section>

        <section className="dref-section">
          <h2>Evidence overlay</h2>
          <div className="dref-rows">
            {EVIDENCE.map((n) => (
              <div key={n} className="dref-row">
                <code>{n}</code>
                <span className="dref-value">{evidenceValues[n] || "—"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dref-section">
          <h2>Type scale</h2>
          <p className="dref-section-note">
            Seven steps. 11px floor for mono labels; there is no hero type.
          </p>
          <div className="dref-type">
            {TYPE_STEPS.map((t) => (
              <div key={t.name} className="dref-type-row">
                <div className="dref-type-meta">
                  <code>{t.name}</code>
                  <span className="dref-value">{typeValues[t.name] || "—"}</span>
                  <span className="dref-note">{t.role}</span>
                </div>
                <div
                  className="dref-type-sample"
                  style={{ fontSize: `var(${t.name})` }}
                >
                  Parse it. Then prove every block.
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="dref-section">
          <h2>Weights</h2>
          <div className="dref-weights">
            {WEIGHTS.map((w) => (
              <div key={w.w} className="dref-weight" style={{ fontWeight: w.w }}>
                <span className="dref-weight-sample">Ag</span>
                <span className="dref-note">
                  {w.w} · {w.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="dref-section">
          <h2>Radius</h2>
          <div className="dref-boxes">
            {RADII.map((r) => (
              <div key={r} className="dref-box-item">
                <span
                  className="dref-box"
                  style={{ borderRadius: `var(${r})` }}
                />
                <code>{r}</code>
                <span className="dref-value">{radiiValues[r] || "—"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dref-section">
          <h2>Elevation</h2>
          <p className="dref-section-note">
            Two levels. Structure is carried by borders; shadows are for
            overlays only.
          </p>
          <div className="dref-boxes">
            {SHADOWS.map((s) => (
              <div key={s} className="dref-box-item">
                <span
                  className="dref-box dref-box-lift"
                  style={{ boxShadow: `var(${s})` }}
                />
                <code>{s}</code>
                <span className="dref-value">{shadowValues[s] || "—"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dref-section">
          <h2>Motion</h2>
          <div className="dref-rows">
            {DURATIONS.map((d) => (
              <div key={d} className="dref-row">
                <code>{d}</code>
                <span className="dref-value">{durationValues[d] || "—"}</span>
                <span
                  className="dref-motion-demo"
                  style={{
                    transitionDuration: `var(${d})`,
                    transitionTimingFunction: "var(--ease-standard)",
                  }}
                  aria-hidden="true"
                />
              </div>
            ))}
            {EASINGS.map((e) => (
              <div key={e} className="dref-row">
                <code>{e}</code>
                <span className="dref-value">{durationValues[e] || "—"}</span>
              </div>
            ))}
          </div>
          <p className="dref-section-note">Hover a duration row to preview it.</p>
        </section>

        <section className="dref-section">
          <h2>Chrome heights</h2>
          <div className="dref-rows">
            {CHROME.map((c) => (
              <div key={c} className="dref-row">
                <code>{c}</code>
                <span className="dref-value">{chromeValues[c] || "—"}</span>
                <span
                  className="dref-chrome-bar"
                  style={{ height: `var(${c})` }}
                  aria-hidden="true"
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
