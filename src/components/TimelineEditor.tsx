import React, { useRef, useState } from "react";
import type { FireEvent } from "../types";

const KIND_COLOR: Record<string, string> = {
  one_time_flow: "#f0883e",
  regime_change: "#58a6ff",
  crash: "#ff7b72",
};
const KIND_ROW: Record<string, number> = { one_time_flow: 0, regime_change: 1, crash: 2 };

const W = 1000;
const H = 190;
const PAD_L = 30;
const PAD_R = 30;
const AXIS_Y = 158;
const ROW_Y = [52, 88, 124];

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

  const startAge = props.startYear - props.birthYear;
  const minAge = startAge;
  const maxAge = props.horizonAge;
  const span = Math.max(maxAge - minAge, 1);

  const ageToX = (age: number) =>
    PAD_L + ((age - minAge) / span) * (W - PAD_L - PAD_R);
  const eventAge = (ev: FireEvent) =>
    ev.age ?? (ev.year ?? props.startYear) - props.birthYear;
  const labelFor = (age: number) =>
    props.axisMode === "age" ? age : props.birthYear + age;

  const pointerToAge = (clientX: number): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width; // svg scales to width
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
      <line x1={PAD_L} y1={AXIS_Y} x2={W - PAD_R} y2={AXIS_Y} stroke="#2d333b" strokeWidth={1.5} />
      {ticks.map((a) => (
        <g key={a}>
          <line x1={ageToX(a)} y1={AXIS_Y - 4} x2={ageToX(a)} y2={AXIS_Y + 4} stroke="#2d333b" />
          <text x={ageToX(a)} y={AXIS_Y + 20} fill="#8b949e" fontSize={12} textAnchor="middle">
            {labelFor(a)}
          </text>
        </g>
      ))}
      <text x={W - PAD_R} y={H - 4} fill="#8b949e" fontSize={11} textAnchor="end">
        {props.axisMode === "age" ? "age — drag markers to move them" : "year — drag markers to move them"}
      </text>

      {/* retirement line */}
      <g
        style={{ cursor: "ew-resize" }}
        onPointerDown={(e) => {
          try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
          setDrag({ type: "retire" });
        }}
      >
        <rect x={retX - 7} y={18} width={14} height={AXIS_Y - 18} fill="transparent" />
        <line x1={retX} y1={26} x2={retX} y2={AXIS_Y} stroke="#d29922"
          strokeWidth={drag?.type === "retire" ? 2.5 : 1.5} strokeDasharray="5 4" />
        <text x={retX} y={16} fill="#d29922" fontSize={12} textAnchor="middle">
          retire {labelFor(props.retirementAge)}
        </text>
      </g>

      {/* events */}
      {props.events.map((ev, i) => {
        const age = eventAge(ev);
        const x = ageToX(age);
        const y = ROW_Y[KIND_ROW[ev.kind] ?? 0];
        const color = KIND_COLOR[ev.kind] ?? "#8b949e";
        const active = drag?.type === "event" && drag.index === i;
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
            <text x={x} y={y - 14} fill={color} fontSize={12} textAnchor="middle">
              {ev.name || ev.kind.replace(/_/g, " ")}
            </text>
            <line x1={x} y1={y + 9} x2={x} y2={AXIS_Y} stroke={color} strokeWidth={0.6}
              opacity={0.45} />
          </g>
        );
      })}
    </svg>
  );
}
