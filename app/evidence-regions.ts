export type NormalizedBbox = readonly [
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
];

export type SourceEvidenceRegion = {
  id: string;
  parserId: string;
  label: string;
  pageNumber: number;
  bbox: NormalizedBbox;
  provenance: "native";
  artifactId: string;
  jsonPointer: string;
};

export function isNormalizedBbox(value: unknown): value is NormalizedBbox {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [xMin, yMin, xMax, yMax] = value;
  return (
    value.every(Number.isFinite) &&
    xMin >= 0 &&
    yMin >= 0 &&
    xMax <= 1 &&
    yMax <= 1 &&
    xMax > xMin &&
    yMax > yMin
  );
}

export function isNativeSourceEvidenceRegion(
  value: unknown,
): value is SourceEvidenceRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  return (
    region.provenance === "native" &&
    typeof region.id === "string" &&
    typeof region.parserId === "string" &&
    typeof region.label === "string" &&
    Number.isInteger(region.pageNumber) &&
    (region.pageNumber as number) > 0 &&
    isNormalizedBbox(region.bbox) &&
    typeof region.artifactId === "string" &&
    typeof region.jsonPointer === "string"
  );
}

export function regionsForPage(
  regions: readonly unknown[],
  parserId: string,
  pageNumber: number,
) {
  return regions
    .filter(isNativeSourceEvidenceRegion)
    .filter(
      (region) =>
        (parserId === "*" || region.parserId === parserId) &&
        region.pageNumber === pageNumber,
    );
}

export function normalizedBboxStyle(bbox: NormalizedBbox) {
  if (!isNormalizedBbox(bbox)) {
    throw new Error("Source evidence bbox must be normalized top-left geometry.");
  }
  const [xMin, yMin, xMax, yMax] = bbox;

  return {
    left: `${xMin * 100}%`,
    top: `${yMin * 100}%`,
    width: `${(xMax - xMin) * 100}%`,
    height: `${(yMax - yMin) * 100}%`,
  };
}
