export type ParserId = "opendataloader" | "mineru" | "azuredi";
export type RunStatus = "idle" | "running" | "complete" | "failed";
export type MobilePane = "source" | "results";

export type WorkspaceState = {
  documentReady: boolean;
  runs: Record<ParserId, RunStatus>;
  activeEvidence: string | null;
  pinnedEvidence: string | null;
  page: number;
  pageCount: number | null;
  mobilePane: MobilePane;
};

export type WorkspaceAction =
  | { type: "start-run"; parser: ParserId }
  | { type: "complete-run"; parser: ParserId }
  | { type: "fail-run"; parser: ParserId }
  | { type: "activate-evidence"; evidence: string | null }
  | { type: "pin-evidence"; evidence: string }
  | { type: "clear-evidence" }
  | { type: "set-page"; page: number }
  | { type: "set-page-count"; pageCount: number }
  | { type: "set-mobile-pane"; pane: MobilePane };

export function createWorkspaceState(demo = false): WorkspaceState {
  return {
    documentReady: true,
    runs: {
      opendataloader: demo ? "complete" : "idle",
      mineru: "idle",
      azuredi: "idle",
    },
    activeEvidence: null,
    pinnedEvidence: null,
    page: 1,
    pageCount: demo ? 12 : null,
    mobilePane: "source",
  };
}

export function canChooseParser(state: WorkspaceState) {
  return state.documentReady;
}

export function canCompare(state: WorkspaceState) {
  return Object.values(state.runs).filter((status) => status === "complete")
    .length >= 2;
}

export function displayedEvidence(state: WorkspaceState) {
  return state.pinnedEvidence ?? state.activeEvidence;
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "start-run": {
      const current = state.runs[action.parser];
      if (!state.documentReady || (current !== "idle" && current !== "failed")) {
        return state;
      }
      return {
        ...state,
        runs: { ...state.runs, [action.parser]: "running" },
      };
    }
    case "complete-run":
    case "fail-run":
      if (state.runs[action.parser] !== "running") return state;
      return {
        ...state,
        runs: {
          ...state.runs,
          [action.parser]:
            action.type === "complete-run" ? "complete" : "failed",
        },
      };
    case "activate-evidence":
      return { ...state, activeEvidence: action.evidence };
    case "pin-evidence":
      return {
        ...state,
        pinnedEvidence:
          state.pinnedEvidence === action.evidence ? null : action.evidence,
      };
    case "clear-evidence":
      return { ...state, activeEvidence: null, pinnedEvidence: null };
    case "set-page": {
      const upperBound = state.pageCount ?? Math.max(1, action.page);
      return {
        ...state,
        page: Math.max(1, Math.min(upperBound, action.page)),
        activeEvidence: null,
        pinnedEvidence: null,
      };
    }
    case "set-page-count": {
      const pageCount = Math.max(1, Math.floor(action.pageCount));
      return {
        ...state,
        pageCount,
        page: Math.min(state.page, pageCount),
      };
    }
    case "set-mobile-pane":
      return { ...state, mobilePane: action.pane };
  }
}
