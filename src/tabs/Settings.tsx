import React from "react";
import { useShallow } from "zustand/react/shallow";
import { InfoTip, Section } from "../components/ui";
import { useStore } from "../store";
import {
  FIRST_TAX_MAINTENANCE_YEAR,
  nextTaxMaintenanceLabel,
  taxMaintenanceCycleYear,
} from "../taxMaintenance";

export default function Settings() {
  const {
    scenario, categories, setCategories,
    taxReminderEnabled, taxReminderDismissedYear,
    setTaxReminderEnabled, resetTaxReminderDismissal,
  } = useStore(useShallow((s) => ({
    scenario: s.scenario, categories: s.categories, setCategories: s.setCategories,
    taxReminderEnabled: s.taxReminderEnabled,
    taxReminderDismissedYear: s.taxReminderDismissedYear,
    setTaxReminderEnabled: s.setTaxReminderEnabled,
    resetTaxReminderDismissal: s.resetTaxReminderDismissal,
  })));
  if (!scenario) return null;
  const now = new Date();
  const cycleYear = taxMaintenanceCycleYear(now);
  const hasActiveCycle = cycleYear >= FIRST_TAX_MAINTENANCE_YEAR
    && taxReminderDismissedYear !== cycleYear;
  const reminderStatus = hasActiveCycle
    ? `Current reminder: November ${cycleYear}, shown until dismissed.`
    : `Next reminder starts: ${nextTaxMaintenanceLabel(now)}.`;

  return (
    <div className="stack">
      <Section
        title="Annual Tax Data Reminder"
        info="Shows a once-a-year November checklist for refreshing the bundled federal tax brackets and contribution limits. It never changes the tax data automatically.">
        <div className="settings-row">
          <label className="toggle-row">
            <input type="checkbox" checked={taxReminderEnabled}
              onChange={(e) => setTaxReminderEnabled(e.target.checked)} />
            <span>Remind me each November</span>
          </label>
          <span className="hint">
            {reminderStatus}
            {taxReminderDismissedYear
              ? ` Dismissed for ${taxReminderDismissedYear}.`
              : " Not dismissed for the current reminder year."}
          </span>
          {taxReminderDismissedYear && (
            <button className="ghost" onClick={resetTaxReminderDismissal}>
              Reset Dismissal
            </button>
          )}
        </div>
      </Section>
      <Section
        title="Spending Categories"
        info="Categories for recorded spending snapshots (Dashboard → Record A Snapshot) and the Cash Flow → Lifestyle Creep chart. Add-only by design: names and order are freely editable, but each category keeps a permanent internal id so renames never break your history. Order is purely organizational."
        actions={
          <button className="ghost" onClick={() => {
            const name = "New Category";
            let slug = "new-category";
            let n = 2;
            while (categories.some((c) => c.slug === slug)) slug = `new-category-${n++}`;
            setCategories([...categories, { slug, name, essential: false }]);
          }}>+ Add Category</button>
        }>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Essential<InfoTip text="Counts toward the essential (non-discretionary) share of spending, matching the Essential flag on expense streams." /></th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c, i) => (
              <tr key={c.slug}>
                <td className="namecell">
                  <input value={c.name} onChange={(ev) =>
                    setCategories(categories.map((x, j) =>
                      j === i ? { ...x, name: ev.target.value } : x))} />
                </td>
                <td>
                  <input type="checkbox" checked={c.essential} onChange={(ev) =>
                    setCategories(categories.map((x, j) =>
                      j === i ? { ...x, essential: ev.target.checked } : x))} />
                </td>
                <td>
                  <span className="pair">
                    <button className="ghost" disabled={i === 0} onClick={() => {
                      const next = [...categories];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      setCategories(next);
                    }}>↑</button>
                    <button className="ghost" disabled={i === categories.length - 1} onClick={() => {
                      const next = [...categories];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      setCategories(next);
                    }}>↓</button>
                  </span>
                </td>
                <td>
                  <button className="ghost" title="Remove (existing snapshot data is kept)"
                    onClick={() => setCategories(categories.filter((_, j) => j !== i))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
