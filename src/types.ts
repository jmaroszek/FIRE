// TypeScript mirror of engine/fire_engine/scenario.py (SCHEMA_VERSION 6)

export type AccountType =
  | "taxable" | "trad_401k" | "trad_ira" | "roth_ira" | "roth_401k" | "hsa" | "cash";

export interface Account {
  type: AccountType;
  balance: number;
  cost_basis?: number | null;
  roth_contribution_basis?: number;
  roth_conversions?: Record<string, number>;
}

export interface Allocation { stocks: number; bonds: number; cash: number }
export interface AssetParams { real_cagr: number; vol: number }

/** An age-keyed override of the base allocation — a glidepath segment. Applies
 *  from start_age until the next segment (mirrors WaterfallSegment). */
export interface AllocationSegment {
  start_age: number;
  allocation: Allocation;
}

export interface MarketModel {
  mode: "bootstrap" | "parametric";
  stocks: AssetParams;
  bonds: AssetParams;
  cash: AssetParams;
  bootstrap_mean_block: number;
  bootstrap_mean_shift: boolean;
  dividend_yield: number;
  /** Weighted fund expense ratio (e.g. 0.0005 = 0.05%); drags the invested return. */
  expense_ratio: number;
}

export interface InflationModel {
  mean: number; persistence: number; sigma: number; initial: number;
}

export interface Income {
  gross_salary: number;
  real_growth: number;
  growth_mode: "nominal" | "real";
  employer_match_pct: number;
  /** Annual bonus on the primary salary line (today's $); compounds at the same
   *  raise, stops at retirement, counts as own FICA/SS wages. */
  bonus?: number;
  /** Per-path lognormal year-to-year variability of the bonus (0 = steady). */
  bonus_vol?: number;
}

/** A secondary income source layered on the primary salary (side hustle, rental,
 *  spouse). No employer match; active over [start_age, end_age]; optional vol. */
export interface IncomeStream {
  name: string;
  annual: number;
  start_age?: number | null;
  end_age?: number | null;
  real_growth: number;
  growth_mode: "nominal" | "real";
  vol: number;
  /** Own FICA/SE-taxed wages — counts toward the Social Security record. */
  ss_covered?: boolean;
}

export interface ExpenseStream {
  name: string;
  annual: number;
  start_age?: number | null;
  end_age?: number | null;
  inflates: boolean;
  extra_inflation: number;
  is_medical: boolean;
  essential: boolean;
}

export interface Liability {
  name: string;
  balance: number;
  interest_rate: number;
  annual_payment: number;
  /** Future loan: begins amortizing at this age; null = present-day debt. */
  start_age?: number | null;
}

export interface GuardrailRule {
  enabled: boolean;
  band: number;
  cut: number;
  boost: number;
  floor_mult: number;
  cap_mult: number;
}

export interface SpendingStrategy {
  kind: "constant_dollar" | "percent_portfolio";
  rate_mode: "fixed" | "vpw";
  rate: number;
  vpw_real_return: number;
  bounded: boolean;
  floor_mult: number;
  ceiling_mult: number;
  smoothing: number;
}

export interface WaterfallStep {
  account: AccountType;
  kind: "to_match" | "max" | "fixed";
  amount?: number | null;
}

/** An age-keyed override of the base waterfall (e.g. divert to taxable while
 *  saving for a house). Applies from start_age until the next segment. */
export interface WaterfallSegment {
  start_age: number;
  steps: WaterfallStep[];
}

export type WithdrawalSource =
  | "cash" | "taxable" | "roth_basis" | "roth_matured_conversions"
  | "trad" | "hsa" | "roth_earnings";

export interface WithdrawalPolicy {
  order: WithdrawalSource[]; // before 59½
  late_order: WithdrawalSource[]; // 59½ and after
  cash_buffer: number;
  allow_early_trad_with_penalty: boolean;
  /** Tax-aware decumulation (59½+). "priority" = strict order (trad draw
   * uncapped). "bracket_filled" = cap the traditional spending draw at
   * `bracket_top`, spilling the overflow to Roth. */
  mode?: "priority" | "bracket_filled";
  bracket_top?: "std_deduction" | "10" | "12" | "22" | "custom";
  custom_top?: number;
}

export interface ConversionRule {
  kind: "none" | "fixed" | "fill_bracket";
  annual_amount: number;
  bracket_top: "std_deduction" | "10" | "12" | "22" | "custom";
  custom_top?: number;
  start_age?: number | null;
  end_age?: number | null;
}

export interface SocialSecurity {
  monthly_at_fra: number; claiming_age: number; haircut: number;
  /** "manual" = use monthly_at_fra (ssa.gov figure); "estimated" = derive it
   * from the plan's covered-earnings history. */
  benefit_mode?: "manual" | "estimated";
  work_start_age?: number | null;   // first year of covered earnings (estimated)
  prior_avg_earnings?: number;       // today's $, flat fill before plan start
  recorded_earnings?: Record<number, number>;  // age -> today's $ (from snapshots)
}

export interface HSARule {
  utilization: number;
  coverage: "self_only" | "family";
  cash_buffer: number;
}

export interface ACAConfig {
  enabled: boolean;
  benchmark_annual: number;
  actual_annual: number;
  coverage_end_age: number;
  fpl_base_single: number;
}

export interface IRMAABracket { magi_threshold: number; annual_surcharge: number }

export interface IRMAAConfig {
  enabled: boolean;
  start_age: number;
  brackets: IRMAABracket[];
}

/** Long-term / end-of-life care provision: a late-life essential, HSA-eligible
 *  medical expense over [onset_age, onset_age + duration_years). Off by default. */
export interface LTCConfig {
  enabled: boolean;
  onset_age: number;
  annual_cost: number;
  duration_years: number;
  extra_inflation: number;
}

export type EventKind = "one_time_flow" | "recurring_flow" | "regime_change" | "crash";

export interface RegimeOverrides {
  gross_salary?: number | null;
  salary_real_growth?: number | null;
  allocation?: Allocation | null;
  employer_match_pct?: number | null;
}

export interface FireEvent {
  kind: EventKind;
  name: string;
  year?: number | null;
  age?: number | null;
  amount: number;
  account?: AccountType | null;
  /** recurring_flow: repeat every N years from age/year through end_age. */
  interval_years?: number;
  end_age?: number | null;
  stock_return?: number | null;
  bond_return?: number | null;
  overrides?: RegimeOverrides | null;
}

export interface Profile {
  birth_year: number; horizon_age: number; state_tax_rate: number;
  filing_status: "single";
}

export interface SimSettings {
  n_paths: number; seed: number; start_year: number;
  success_threshold: number; coast_target_age: number;
  /** Die-with-zero bequest floor (today's $); a path succeeds only if it ends
   *  with at least this much real net worth. 0 = pure die-with-zero. */
  legacy_target: number;
}

export interface Scenario {
  schema_version: number;
  name: string;
  profile: Profile;
  accounts: Account[];
  allocation: Allocation;
  /** Age-keyed overrides of `allocation` (a glidepath); empty/absent = the base
   *  allocation every year. */
  allocation_schedule?: AllocationSegment[];
  market: MarketModel;
  inflation: InflationModel;
  income: Income;
  /** Secondary income beyond the primary salary; empty = single-salary. */
  income_streams: IncomeStream[];
  retirement_age: number;
  expense_streams: ExpenseStream[];
  /** HSA-eligible out-of-pocket medical spending, kept out of the expense table.
   *  Always essential medical; drives HSA utilization. */
  medical_streams: ExpenseStream[];
  liabilities: Liability[];
  waterfall: WaterfallStep[];
  /** Age-keyed overrides of `waterfall`; empty = the base waterfall every year. */
  waterfall_schedule: WaterfallSegment[];
  withdrawal_policy: WithdrawalPolicy;
  conversion_rule: ConversionRule;
  social_security: SocialSecurity;
  hsa: HSARule;
  guardrails: GuardrailRule;
  spending_strategy: SpendingStrategy;
  aca: ACAConfig;
  irmaa: IRMAAConfig;
  /** Long-term / end-of-life care provision; absent = treated as disabled. */
  ltc?: LTCConfig;
  events: FireEvent[];
  sim: SimSettings;
}

// ---- API results

export type FanSeries = Record<string, number[]>; // p5..p95 -> series

export interface BridgeAnalysis {
  has_bridge: boolean;
  bridge_start_age: number;
  bridge_end_age: number;
  bridge_years: number;
  total_paths: number;
  // present only when has_bridge:
  bridge_fail_rate?: number;
  longevity_fail_rate?: number;
  bridge_break_rate?: number;
  early_penalty_rate?: number;
  early_penalty_paths?: number;
  median_penalty_real?: number;
  coverage_p5?: number;
  coverage_p25?: number;
  coverage_p50?: number;
  runway_p5?: number;
  runway_p50?: number;
  resources_p50_real?: number;
  need_p50_real?: number;
  // bridge funding plan: liquid pile needed before a retirement-start conversion seasons
  bridge_funding_years?: number;
  bridge_funding_total_real?: number;
  bridge_funding_tax_real?: number;
  bridge_funding_by_source?: { cash: number; taxable: number; roth_basis: number };
  min_accessible_real?: number[];
  at_retirement?: {
    accessible_real: number;
    locked_real: number;
    pct_accessible: number;
  };
}

export interface SimulateResult {
  success_rate: number;
  fan: { nominal: FanSeries; real: FanSeries };
  pool_medians_real: Record<string, number[]>;
  survival_curve: number[];
  accessibility_real: Record<string, number[]>;
  accessibility_fan: FanSeries;
  bridge: BridgeAnalysis;
  withdrawals_real: Record<string, number[]>;
  ladder_schedule: {
    year: number; age: number; amount_real: number; matures: number;
    trad_remaining_real: number; marginal_rate: number;
    effective_rate: number; conversion_tax_real: number; accessible_left_real: number;
  }[];
  rmd_schedule: {
    year: number; age: number; amount_real: number;
    trad_remaining_real: number; marginal_rate: number;
  }[];
  taxes_median_real: number[];
  expenses_median_real: number[];
  spending_mult_median: number[];
  spending_mult_fan: FanSeries;
  /** Realized total spending in real $ over time, percentile fan (p10/p25/p50).
   * Drives the in-tile Spending Strategy preview: median line + downside band. */
  expenses_fan_real: FanSeries;
  investing_real: Record<string, number[]>;
  liability_balance: number[];
  // outcome-distribution & robustness views
  ending_balance: { nominal: number[]; real: number[] };
  spending_distribution: { total_real: number[]; years_in_cut: number[] };
  age_at_ruin: {
    ages: number[]; counts: number[]; success_paths: number; total_paths: number;
  };
  max_drawdown: number[];
  sequence_scatter: {
    first_window_return: number[]; ending_real: number[];
    survived: boolean[]; window: number; start_age: number;
  };
  success_ci: { rate: number; lo: number; hi: number; n_paths: number };
  healthcare: { net_cost_real?: number[]; subsidy_real?: number[] };
  // lifetime tax / income / inflation surfacing (ride every /simulate)
  ss_income_median_real: number[];
  wages_median_real: number[];
  /** PIA (monthly at FRA, today's $) estimated from the plan's covered earnings. */
  ss_estimated_monthly_at_fra: number;
  rmds_median_real: number[];
  marginal_rate_median: number[];
  effective_rate_median: number[];
  port_return_fan: FanSeries;
  inflation_fan: FanSeries;
  lifetime_tax: { median_real: number; as_pct_of_spending: number; effective_rate: number };
  failure_magnitude: {
    failing_paths: number; total_paths: number;
    median_total_shortfall_real: number; p90_total_shortfall_real: number;
    median_years_short: number;
  };
  ages: number[];
  years: number[];
  scenario_name: string;
}

export interface SweepResult {
  sweep: Record<string, number>;
  threshold: number;
  years_to_fi: number | null;
  // die-with-zero companion: median (+ p25/p75) real ending estate per retire age
  estate_p25?: Record<string, number>;
  estate_p50?: Record<string, number>;
  estate_p75?: Record<string, number>;
  horizon_age?: number;
}

export interface FreedomResult {
  current_total: number;
  fire_number_simple: number;
  fire_progress_simple: number | null;
  fire_number_mc: number | null;
  fire_progress_mc: number | null;
  success_threshold: number;
  coast: {
    coast_number: number;
    progress: number;
    fire_number_at_target: number;
    assumed_real_return: number;
    years_to_target: number;
  };
  annual_retirement_expenses: number;
}

export interface MaxSpendResult {
  max_scale: number;
  base_living_annual: number;
  max_living_annual: number;
  // retirement-only variant: flexes only retirement-and-later living expenses
  retirement_max_scale: number;
  retirement_max_living_annual: number;
  retirement_capped: boolean;
  threshold: number;
  capped: boolean;
}

export interface SurfaceResult {
  ages: number[];
  spending_scales: number[];
  matrix: number[][]; // rows = spending_scales, cols = ages
  threshold: number;
}

export interface TornadoEntry {
  param: string;
  low_label: string; low_success: number;
  high_label: string; high_success: number;
  base_success: number;
}

export interface SensitivityResult {
  base_success: number;
  entries: TornadoEntry[];
  delta: number;
}

export interface StressResult {
  base_success: number;
  stressed_success: number;
  delta: number;
  shock_age: number;
  duration: number;
}

/** Earliest retirement age clearing the success threshold, baseline vs under the
 *  income shock. null = no age through 70 clears it. */
export interface StressEarliestResult {
  base_earliest_age: number | null;
  stressed_earliest_age: number | null;
  shock_age: number;
  duration: number;
  threshold: number;
  horizon_age: number;
}

export interface BridgeCrashResult {
  has_bridge: boolean;
  drop: number;
  years: number;
  retirement_age: number;
  base_success: number;
  stressed_success: number;
  success_delta: number;
  base_bridge_break_rate: number;
  stressed_bridge_break_rate: number;
  base_early_penalty_rate: number;
  stressed_early_penalty_rate: number;
}

export interface TaxRegimeResult {
  base_success: number;
  stressed_success: number;
  delta: number;
  base_lifetime_tax_real: number;
  stressed_lifetime_tax_real: number;
  sunset_age: number;
  bracket_rate_mult: number;
  std_deduction_mult: number;
}

export interface LadderSavingsResult {
  with_ladder_real: number;
  without_ladder_real: number;
  saved_real: number;
}

export interface Snapshot {
  date: string;
  balances: Record<string, number>;
  /** annual spending by category slug, nominal $ at the snapshot date */
  spending?: Record<string, number>;
  /** Social-Security-covered earnings that year, nominal $ at the snapshot date. */
  earnings?: number;
  /** outstanding loan balances by liability name */
  liabilities?: Record<string, number>;
  note?: string;
}

export interface Category {
  slug: string; // permanent identifier; never renamed or reused
  name: string; // display name, freely editable
  essential: boolean;
}
