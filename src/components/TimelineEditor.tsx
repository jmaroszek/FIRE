import React, { useRef, useState } from "react";
import { KIND_META, KIND_ORDER, displayKindOf, type DisplayKind } from "../events";
import type { FireEvent } from "../types";

const W = 1000;
const PAD_L = 30;
const PAD_R = 30;
const ROW_H = 44;
const TOP_PAD = 34;

interface Props {
  events: FireEvent[];
  axisMode: "age" | "year";
  birthYear: number;
  startYear: number;
  horizonAge: number;
  retirementAge: number;
  onEventAge: (index: number, age: number) => void;
  onRetirementAge: (age: number) => void;
}

type Drag = { type: "event"; index: number } | { type: "retire" } | null;

export default function TimelineEditor(props: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);

  const minAge = props.startYear - props.birthYear;
  const maxAge = props.horizonAge;
  const span = Math.max(maxAge - minAge, 1);

  // only lay out rows for kinds that actually have events (min one row)
  const kindsPresent = KIND_ORDER.filter((k) =>
    props.events.some((ev) => displayKindOf(ev) === k));
  const rows: DisplayKind[] = kindsPresent.length ? kindsPresent : ["expense"];
  const rowY = (kind: DisplayKind) =>
    TOP_PAD + 24 + rows.indexOf(kind) * ROW_H;
  const axisY = TOP_PAD + 24 + rows.length * ROW_H - 10;
  const H = axisY + 44;

  const ageToX = (age: number) =>
    PAD_L + ((age - minAge) / span) * (W - PAD_L - PAD_R);
  const eventAge = (ev: FireEvent) =>
    ev.age ?? (ev.year ?? props.startYear) - props.birthYear;
  const labelFor = (age: number) =>
    props.axisMode === "age" ? age : props.birthYear + age;

  const pointerToAge = (clientX: number): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const age = minAge + ((fx * W - PAD_L) / (W - PAD_L - PAD_R)) * span;
    return Math.round(Math.min(Math.max(age, minAge), maxAge));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const age = pointerToAge(e.clientX);
    if (drag.type === "retire") {
      if (age !== props.retirementAge && age > minAge) props.onRetirementAge(age);
    } else {
      const ev = props.events[drag.index];
      if (ev && eventAge(ev) !== age) props.onEventAge(drag.index, age);
    }
  };

  // stagger labels when same-row events sit close together
  const labelLevel = new Map<number, number>();
  for (const kind of rows) {
    const members = props.events
      .map((ev, i) => ({ ev, i }))
      .filter(({ ev }) => displayKindOf(ev) === kind)
      .sort((a, b) => eventAge(a.ev) - eventAge(b.ev));
    let prevAge = -Infinity;
    let level = 0;
    for (const { ev, i } of members) {
      const age = eventAge(ev);
      level = age - prevAge < span * 0.09 ? (level + 1) % 2 : 0;
      labelLevel.set(i, level);
      prevAge = age;
    }
  }

  const ticks: number[] = [];
  const step = span > 45 ? 10 : 5;
  for (let a = Math.ceil(minAge / step) * step; a <= maxAge; a += step) ticks.push(a);

  const retX = ageToX(props.retirementAge);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="timeline-editor"
      style={{ width: "100%", touchAction: "none", userSelect: "none" }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      {/* axis */}
      <line x1={PAD_L} y1={axisY} x2={W - PAD_R} y2={axisY} stroke="#2d333b" strokeWidth={1.5} />
      {ticks.map((a) => (
        <g key={a}>
          <line x1={ageToX(a)} y1={axisY - 4} x2={ageToX(a)} y2={axisY + 4} stroke="#2d333b" />
          <text x={ageToX(a)} y={axisY + 20} fill="#8b949e" fontSize={12} textAnchor="middle">
            {labelFor(a)}
          </text>
        </g>
      ))}
      <text x={(PAD_L + W - PAD_R) / 2} y={axisY + 40} fill="#8b949e" fontSize={12}
        textAnchor="middle">
        {props.axisMode === "age" ? "Age" : "Year"}
      </text>

      {/* retirement line */}
      <g
        style={{ cursor: "ew-resize" }}
        onPointerDown={(e) => {
          try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
          setDrag({ type: "retire" });
        }}
      >
        <rect x={retX - 7} y={16} width={14} height={axisY - 16} fill="transparent" />
        <line x1={retX} y1={24} x2={retX} y2={axisY} stroke="#d29922"
          strokeWidth={drag?.type === "retire" ? 2.5 : 1.5} strokeDasharray="5 4" />
        <text x={retX} y={14} fill="#d29922" fontSize={12} textAnchor="middle">
          Retire {labelFor(props.retirementAge)}
        </text>
      </g>

      {/* events */}
      {props.events.map((ev, i) => {
        const kind = displayKindOf(ev);
        const age = eventAge(ev);
        const x = ageToX(age);
        const y = rowY(kind);
        const color = KIND_META[kind].color;
        const active = drag?.type === "event" && drag.index === i;
        const labelY = y - 14 - (labelLevel.get(i) ?? 0) * 15;
        return (
          <g
            key={i}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
              setDrag({ type: "event", index: i });
            }}
          >
            <rect x={x - 14} y={y - 14} width={28} height={28} fill="transparent" />
            <rect x={x - 7} y={y - 7} width={14} height={14} fill={color}
              transform={`rotate(45 ${x} ${y})`}
              stroke={active ? "#c9d1d9" : "none"} strokeWidth={2} />
            <text x={x} y={labelY} fill={color} fontSize={12} textAnchor="middle">
              {ev.name || KIND_META[kind].label}
            </text>
            <line x1={x} y1={y + 9} x2={x} y2={axisY} stroke={color} strokeWidth={0.6}
              opacity={0.45} />
          </g>
        );
      })}
    </svg>
  );
}
