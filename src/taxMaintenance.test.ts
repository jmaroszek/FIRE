import { describe, expect, it } from "vitest";
import { nextTaxMaintenanceLabel, shouldShowTaxMaintenanceReminder } from "./taxMaintenance";

describe("tax maintenance reminder", () => {
  it("shows once during November when enabled", () => {
    const now = new Date("2026-11-15T12:00:00");
    expect(shouldShowTaxMaintenanceReminder(now, true, null)).toBe(true);
    expect(shouldShowTaxMaintenanceReminder(now, true, 2025)).toBe(true);
  });

  it("stays hidden outside November", () => {
    expect(shouldShowTaxMaintenanceReminder(new Date("2026-10-31T12:00:00"), true, null)).toBe(false);
    expect(shouldShowTaxMaintenanceReminder(new Date("2026-12-01T12:00:00"), true, null)).toBe(false);
  });

  it("respects disabled and dismissed states", () => {
    const now = new Date("2026-11-15T12:00:00");
    expect(shouldShowTaxMaintenanceReminder(now, false, null)).toBe(false);
    expect(shouldShowTaxMaintenanceReminder(now, true, 2026)).toBe(false);
  });

  it("labels the next November maintenance window", () => {
    expect(nextTaxMaintenanceLabel(new Date("2026-06-30T12:00:00"))).toBe("November 2026");
    expect(nextTaxMaintenanceLabel(new Date("2026-12-01T12:00:00"))).toBe("November 2027");
  });
});
