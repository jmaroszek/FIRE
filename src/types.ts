// TypeScript mirror of engine/fire_engine/scenario.py (SCHEMA_VERSION 1)

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

export interface MarketModel {
  mode: "bootstrap" | "parametric";
  stocks: AssetParams;
  bonds: AssetParams;
  cash: AssetParams;
  bootstrap_mean_block: number;
  bootstrap_mean_shift: boolean;
  dividend_yield: number;
}

export interface InflationModel {
  mean: number; persistence: number; sigma: number; initial: number;
}

export interface Income {
  gross_salary: number; real_growth: number; employer_match_pct: number;
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

export interface GuardrailRule {
  enabled: boolean;
  band: number;
  cut: number;
  boost: number;
  floor_mult: number;
  cap_mult: number;
}

export interface WaterfallStep {
  account: AccountType;
  kind: "to_match" | "max" | "fixed";
  amount?: number | null;
}

export type WithdrawalSource =
  | "cash" | "taxable" | "roth_basis" | "roth_matured_conversions"
  | "trad" | "hsa" | "roth_earnings";

export interface WithdrawalPolicy {
  order: WithdrawalSource[];
  cash_buffer: number;
  allow_early_trad_with_penalty: boolean;
}

export interface ConversionRule {
  kind: "none" | "fixed" | "fill_bracket";
  annual_amount: number;
  bracket_top: "std_deduction" | "10" | "12" | "22";
  start_age?: number | null;
  end_age?: number | null;
}

export interface SocialSecurity {
  monthly_at_fra: number; claiming_age: number; haircut: number;
}

export interface HSARule { utilization: number; coverage: "self_only" | "family" }

export type EventKind = "one_time_flow" | "regime_change" | "crash";

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
}

export interface Scenario {
  schema_version: number;
  name: string;
  profile: Profile;
  accounts: Account[];
  allocation: Allocation;
  market: MarketModel;
  inflation: InflationModel;
  income: Income;
  retirement_age: number;
  expense_streams: ExpenseStream[];
  waterfall: WaterfallStep[];
  withdrawal_policy: WithdrawalPolicy;
  conversion_rule: ConversionRule;
  social_security: SocialSecurity;
  hsa: HSARule;
  guardrails: GuardrailRule;
  events: FireEvent[];
  sim: SimSettings;
}

// ---- API results

export type FanSeries = Record<string, number[]>; // p5..p95 -> series

export interface SimulateResult {
  success_rate: number;
  fan: { nominal: FanSeries; real: FanSeries };
  pool_medians_real: Record<string, number[]>;
  survival_curve: number[];
  accessibility_real: Record<string, number[]>;
  ladder_schedule: { year: number; age: number; amount_real: number; matures: number }[];
  taxes_median_real: number[];
  expenses_median_real: number[];
  spending_mult_median: number[];
  ages: number[];
  years: number[];
  scenario_name: string;
}

export interface SweepResult {
  sweep: Record<string, number>;
  threshold: number;
  years_to_fi: number | null;
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

export interface Snapshot {
  date: string;
  balances: Record<string, number>;
  note?: string;
}
