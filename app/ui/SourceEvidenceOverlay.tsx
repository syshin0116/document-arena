"use client";

import {
  normalizedBboxStyle,
  regionsForPage,
  type SourceEvidenceRegion,
} from "../evidence-regions";

export function SourceEvidenceOverlay({
  regions,
  parserId,
  pageNumber,
  activeEvidence,
  pinnedEvidence,
  comparing,
  onActivate,
  onPin,
}: {
  regions: readonly SourceEvidenceRegion[];
  parserId: string;
  pageNumber: number;
  activeEvidence: string | null;
  pinnedEvidence: string | null;
  comparing: boolean;
  onActivate: (id: string | null) => void;
  onPin: (id: string) => void;
}) {
  const pageRegions = regionsForPage(regions, parserId, pageNumber);
  if (pageRegions.length === 0) return null;

  return (
    <div className="evidence-layer" aria-label="Parser-native source regions">
      {pageRegions.map((region, index) => (
        <button
          key={`${region.artifactId}:${region.jsonPointer}`}
          className="source-box"
          style={normalizedBboxStyle(region.bbox)}
          type="button"
          data-active={activeEvidence === region.id || undefined}
          data-pinned={pinnedEvidence === region.id || undefined}
          data-parser={
            region.parserId === "mineru"
              ? "mineru"
              : region.parserId === "azuredi"
                ? "azuredi"
                : undefined
          }
          aria-label={`Highlight parsed ${region.label}`}
          aria-pressed={pinnedEvidence === region.id}
          title={`${region.label} · native parser geometry`}
          onMouseEnter={() => onActivate(region.id)}
          onMouseLeave={() => onActivate(null)}
          onFocus={() => onActivate(region.id)}
          onBlur={() => onActivate(null)}
          onClick={() => onPin(region.id)}
        >
          <span>
            {comparing
              ? region.parserId === "azuredi"
                ? "C"
                : region.parserId === "mineru"
                  ? "B"
                  : "A"
              : ""}
            {String(index + 1).padStart(2, "0")}
          </span>
        </button>
      ))}
    </div>
  );
}
