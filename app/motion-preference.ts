export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function preferredScrollBehavior(
  prefersReducedMotion =
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia(REDUCED_MOTION_QUERY).matches,
): ScrollBehavior {
  return prefersReducedMotion ? "auto" : "smooth";
}
