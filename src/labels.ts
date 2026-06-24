// Shared display names for account types and withdrawal sources.

import type { AccountType, WithdrawalSource } from "./types";

export const ACCOUNT_LABELS: Record<AccountType, string> = {
  taxable: "Brokerage",
  trad_401k: "Traditional 401k",
  trad_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  roth_401k: "Roth 401k",
  hsa: "HSA",
  cash: "Cash",
};

export const SOURCE_LABELS: Record<WithdrawalSource, string> = {
  cash: "Cash",
  taxable: "Brokerage",
  roth_basis: "Roth Contributions",
  roth_matured_conversions: "Matured Conversions",
  trad: "Traditional (59½+)",
  hsa: "HSA (65+)",
  roth_earnings: "Roth Earnings (59½+)",
};

// The five tax pools accounts merge into. Distinct taxonomy from AccountType
// (which has per-account granularity) and WithdrawalSource (which splits Roth).
export const POOL_LABELS: Record<string, string> = {
  taxable: "Brokerage", trad: "Traditional", roth: "Roth", hsa: "HSA", cash: "Cash",
};
