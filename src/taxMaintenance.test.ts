import { describe, expect, it } from "vitest";
import {
  nextTaxMaintenanceLabel,
  shouldShowTaxMaintenanceReminder,
  taxMaintenanceCycleYear,
} from "./taxMaintenance";

describe("tax maintenance reminder", () => {
  it("starts with the November maintenance cycle when enabled", () => {
    const now = new Date("2026-11-15T12:00:00");
    expect(shouldShowTaxMaintenanceReminder(now, true, null)).toBe(true);
    expect(shouldShowTaxMaintenanceReminder(now, true, 2025)).toBe(true);
  });

  it("persists after November until that cycle is dismissed", () => {
    expect(shouldShowTaxMaintenanceReminder(new Date("2026-12-01T12:00:00"), true, null)).toBe(true);
    expect(shouldShowTaxMaintenanceReminder(new Date("2026-12-01T12:00:00"), true, 2026)).toBe(false);
    expect(shouldShowTaxMaintenanceReminder(new Date("2027-03-15T12:00:00"), true, null)).toBe(true);
    expect(shouldShowTaxMaintenanceReminder(new Date("2027-03-15T12:00:00"), true, 2026)).toBe(false);
  });

  it("stays hidden before the first configured November cycle", () => {
    expect(shouldShowTaxMaintenanceReminder(new Date("2026-10-31T12:00:00"), true, null)).toBe(false);
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

  it("keys dismissal to the most recent November cycle", () => {
    expect(taxMaintenanceCycleYear(new Date("2026-11-15T12:00:00"))).toBe(2026);
    expect(taxMaintenanceCycleYear(new Date("2027-01-15T12:00:00"))).toBe(2026);
    expect(taxMaintenanceCycleYear(new Date("2027-11-15T12:00:00"))).toBe(2027);
  });
});
