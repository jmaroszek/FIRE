export const TAX_MAINTENANCE_MONTH = 10; // November; Date months are zero-based.
export const FIRST_TAX_MAINTENANCE_YEAR = 2026;
export const TAX_REMINDER_ENABLED_KEY = "fire:taxReminderEnabled";
export const TAX_REMINDER_DISMISSED_YEAR_KEY = "fire:taxReminderDismissedYear";

export function readTaxReminderEnabled(): boolean {
  try {
    return localStorage.getItem(TAX_REMINDER_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeTaxReminderEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(TAX_REMINDER_ENABLED_KEY, String(enabled));
  } catch {
    /* ignore storage failures; the in-memory state still works for this session */
  }
}

export function readTaxReminderDismissedYear(): number | null {
  try {
    const raw = localStorage.getItem(TAX_REMINDER_DISMISSED_YEAR_KEY);
    if (!raw) return null;
    const year = Number(raw);
    return Number.isInteger(year) ? year : null;
  } catch {
    return null;
  }
}

export function writeTaxReminderDismissedYear(year: number | null): void {
  try {
    if (year === null) localStorage.removeItem(TAX_REMINDER_DISMISSED_YEAR_KEY);
    else localStorage.setItem(TAX_REMINDER_DISMISSED_YEAR_KEY, String(year));
  } catch {
    /* ignore storage failures */
  }
}

export function shouldShowTaxMaintenanceReminder(
  now: Date,
  enabled: boolean,
  dismissedYear: number | null,
): boolean {
  const cycleYear = taxMaintenanceCycleYear(now);
  return enabled
    && cycleYear >= FIRST_TAX_MAINTENANCE_YEAR
    && dismissedYear !== cycleYear;
}

export function taxMaintenanceCycleYear(now: Date): number {
  return now.getMonth() >= TAX_MAINTENANCE_MONTH
    ? now.getFullYear()
    : now.getFullYear() - 1;
}

export function nextTaxMaintenanceLabel(now: Date): string {
  const year = now.getMonth() <= TAX_MAINTENANCE_MONTH
    ? now.getFullYear()
    : now.getFullYear() + 1;
  return `November ${year}`;
}
