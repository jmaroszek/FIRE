// App-wide domain constants. Mirrors the engine's age conventions
// (engine/fire_engine/constants.py) so the UI and the model never drift.

/** Annual-grain stand-in for 59½: traditional and Roth earnings become
 *  penalty-free the year the person turns 60 (matches the engine). */
export const PENALTY_FREE_AGE = 60;

/** HSA non-medical withdrawals become penalty-free at 65. */
export const HSA_PENALTY_FREE_AGE = 65;

/** Display label for the 59½ penalty-free milestone (the model unlocks it at 60). */
export const PENALTY_FREE_AGE_LABEL = "59½";

/** Per-scenario line colors on the Compare tab. A color is bound to a scenario
 *  when it's pinned (the first unused hue) and kept for the slot's whole life, so
 *  every Compare chart and the legend chips agree and removing a middle scenario
 *  never recolors the rest. */
export const COMPARE_PALETTE = [
  "#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f0883e", "#ff7b72",
];
