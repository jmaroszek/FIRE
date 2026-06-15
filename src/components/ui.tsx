import React, { useState } from "react";

export const fmtMoney = (v: number | null | undefined, digits = 0): string =>
  v == null || !isFinite(v)
    ? "—"
    : v.toLocaleString("en-US", {
        style: "currency", currency: "USD",
        maximumFractionDigits: digits, minimumFractionDigits: 0,
      });

export const fmtPct = (v: number | null | undefined, digits = 1): string =>
  v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export function Section(props: {
  title: string; info?: string; children: React.ReactNode; actions?: React.ReactNode;
  wide?: boolean; className?: string;
}) {
  return (
    <section className={["card", props.wide ? "wide" : "", props.className ?? ""].join(" ").trim()}>
      <div className="card-head">
        <h3>
          {props.title}
          {props.info && <InfoTip text={props.info} />}
        </h3>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

/** A card whose body collapses behind its title — for "set once a year" inputs
 * that shouldn't dominate the Plan tab. Native <details> (free keyboard + a11y),
 * collapsed by default. Actions in the header don't toggle the panel. */
export function Collapsible(props: {
  title: string; info?: string; children: React.ReactNode;
  actions?: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details className="card collapsible" open={props.defaultOpen ?? false}>
      <summary>
        <h3>
          {props.title}
          {props.info && <InfoTip text={props.info} />}
        </h3>
        {props.actions && (
          <span className="collapsible-actions" onClick={(e) => e.stopPropagation()}>
            {props.actions}
          </span>
        )}
        <span className="chev" aria-hidden="true">▸</span>
      </summary>
      <div className="collapsible-body">{props.children}</div>
    </details>
  );
}

/** A titled row of content-sized cards within a tab. */
export function Group(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="input-group">
      <h2 className="group-title">{props.title}</h2>
      <div className="group-grid">{props.children}</div>
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  // fixed positioning escapes any scrollable card, so tooltips never create
  // or require scrollbars
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const ref = React.useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={ref}
      className="infotip"
      onMouseEnter={() => {
        const r = ref.current!.getBoundingClientRect();
        const above = r.bottom > window.innerHeight - 190;
        setPos({
          x: Math.max(8, Math.min(r.left - 20, window.innerWidth - 320)),
          y: above ? r.top - 8 : r.bottom + 8,
          above,
        });
      }}
      onMouseLeave={() => setPos(null)}
    >
      ⓘ
      {pos && (
        <span
          className="infotip-body"
          style={{
            left: pos.x,
            top: pos.above ? undefined : pos.y,
            bottom: pos.above ? window.innerHeight - pos.y : undefined,
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Field(props: { label: string; info?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {props.label}
        {props.info && <InfoTip text={props.info} />}
      </span>
      {props.children}
    </label>
  );
}

/** Numeric input that tolerates intermediate editing states. */
export function NumberInput(props: {
  value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; suffix?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <span className="numwrap">
      <input
        type="number"
        value={text ?? String(props.value)}
        step={props.step}
        min={props.min}
        max={props.max}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) props.onChange(v);
        }}
        onBlur={() => setText(null)}
      />
      {props.suffix && <span className="suffix">{props.suffix}</span>}
    </span>
  );
}

/** Percent input: displays 5 for 0.05 */
export function PercentInput(props: {
  value: number; onChange: (v: number) => void; step?: number;
}) {
  return (
    <NumberInput
      value={Math.round(props.value * 10000) / 100}
      step={props.step ?? 0.5}
      suffix="%"
      onChange={(v) => props.onChange(v / 100)}
    />
  );
}

export function Stat(props: { label: string; value: string; sub?: string; info?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">
        {props.label}
        {props.info && <InfoTip text={props.info} />}
      </div>
      <div className="stat-value">{props.value}</div>
      {props.sub && <div className="stat-sub">{props.sub}</div>}
    </div>
  );
}

export function ProgressBar({ fraction }: { fraction: number }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      <span className="progress-text">{fmtPct(fraction)}</span>
    </div>
  );
}
