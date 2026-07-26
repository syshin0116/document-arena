import type { ParserId } from "./workspace-state";

/** The runner component each parser id maps to. */
export const LOCAL_COMPONENT_IDS: Record<ParserId, string> = {
  opendataloader: "opendataloader-pdf",
  mineru: "mineru-pipeline",
  azuredi: "azure-di",
};

export const LOCAL_PARSER_ORDER: readonly ParserId[] = [
  "opendataloader",
  "mineru",
  "azuredi",
];

export const PARSER_ACCENT: Record<ParserId, "indigo" | "amber" | "teal"> = {
  opendataloader: "indigo",
  mineru: "amber",
  azuredi: "teal",
};

export const PARSER_LETTER: Record<ParserId, string> = {
  opendataloader: "A",
  mineru: "B",
  azuredi: "C",
};

export const PARSER_DISPLAY: Record<ParserId, string> = {
  opendataloader: "OpenDataLoader",
  mineru: "MinerU",
  azuredi: "Azure DI",
};

/**
 * Column letter and hue by position, not by parser.
 *
 * A blind comparison shuffles the candidates, so anything keyed on the parser
 * would survive the shuffle and name it: OpenDataLoader is always indigo "A" in
 * the workspace. Positional accents stay decorative.
 */
export const POSITION_LETTERS = ["A", "B", "C"] as const;
export const POSITION_ACCENTS = ["indigo", "amber", "teal"] as const;
