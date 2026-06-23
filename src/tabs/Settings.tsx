import React from "react";
import { InfoTip, Section } from "../components/ui";
import { useStore } from "../store";

export default function Settings() {
  const { scenario, categories, setCategories } = useStore();
  if (!scenario) return null;

  return (
    <div className="stack">
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
