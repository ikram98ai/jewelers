import { useMediaQuery } from "@mantine/hooks";

/** Below Mantine's `sm` breakpoint (48em): the phone layout with the bottom tab bar. */
export const MOBILE_QUERY = "(max-width: 47.99em)";

/**
 * True on phone-width screens. Read synchronously on first render so layout
 * decisions (e.g. hiding the tab bar on desktop) don't flash.
 * Prefer CSS / `hiddenFrom` / responsive style props; use this only where a
 * prop value itself must change (labels, pagination size, AppShell config).
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY, typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches, {
    getInitialValueInEffect: false,
  });
}
