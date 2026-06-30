/**
 * Date formatting utilities for Diamond Mind.
 * All dates are YYYY-MM-DD strings in ET.
 */

/** "2026-06-29" → "Mon, Jun 29" */
export function fmtDateHuman(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  // Use UTC noon to avoid any timezone shift on the display day.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/** Returns today's date string YYYY-MM-DD in ET. */
export function todayETDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Returns true when iso matches today in ET. */
export function isToday(iso: string): boolean {
  return iso === todayETDate();
}
