// Client-side housing math for the Housing tab's calculators (loan comparison,
// rent-vs-buy). These are instant, side-effect-free what-ifs that sit on top of
// the saved scenario — they never touch the engine. They compute accurate
// MONTHLY amortization (what a lender quotes); the engine projects the plan-of-
// record home with an annual approximation, so the Equity-Over-Time chart (engine
// output) and these calculators can differ by a rounding. See docs/ASSUMPTIONS.md.

export interface LoanTerms {
  price: number; // today's $
  downPct: number;
  rate: number; // annual nominal
  termYears: number;
  points?: number; // % of loan, paid up front
  type?: "fixed" | "arm";
  armFixedYears?: number;
  armResetRate?: number;
}

/** Standard monthly mortgage payment that amortizes `principal` over `termYears`. */
export function monthlyPayment(principal: number, annualRate: number, termYears: number): number {
  if (principal <= 0 || termYears <= 0) return 0;
  const r = annualRate / 12;
  const n = termYears * 12;
  if (r <= 1e-12) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export interface AmortPoint {
  year: number;
  balance: number; // end-of-year balance
  interestPaid: number; // interest paid during the year
  principalPaid: number; // principal paid during the year
}

export interface AmortResult {
  loan: number;
  monthly: number; // initial monthly payment
  totalInterest: number;
  payoffYear: number; // years until the balance hits zero
  upfront: number; // down payment + points (closing excluded; add separately)
  schedule: AmortPoint[]; // year 0..termYears, balance over time
}

/** Monthly amortization rolled up to annual points, with a single optional ARM reset. */
export function amortize(t: LoanTerms): AmortResult {
  const loan = t.price * (1 - t.downPct);
  let bal = loan;
  let rate = t.rate;
  let pay = monthlyPayment(loan, rate, t.termYears);
  const schedule: AmortPoint[] = [{ year: 0, balance: bal, interestPaid: 0, principalPaid: 0 }];
  let totalInterest = 0;
  let payoffYear = t.termYears;
  for (let y = 1; y <= t.termYears; y++) {
    // ARM reset at the start of the reset year: re-amortize the balance at the new rate.
    if (t.type === "arm" && t.armFixedYears && y - 1 === t.armFixedYears) {
      rate = t.armResetRate ?? rate;
      pay = monthlyPayment(bal, rate, t.termYears - t.armFixedYears);
    }
    let yearInterest = 0;
    let yearPrincipal = 0;
    for (let m = 0; m < 12 && bal > 1e-9; m++) {
      const interest = bal * (rate / 12);
      const principal = Math.min(pay - interest, bal);
      bal -= principal;
      yearInterest += interest;
      yearPrincipal += principal;
    }
    totalInterest += yearInterest;
    schedule.push({ year: y, balance: Math.max(bal, 0), interestPaid: yearInterest, principalPaid: yearPrincipal });
    if (bal <= 1e-9 && payoffYear === t.termYears) payoffYear = y;
  }
  return {
    loan,
    monthly: monthlyPayment(loan, t.rate, t.termYears),
    totalInterest,
    payoffYear,
    upfront: t.price * t.downPct + loan * (t.points ?? 0),
    schedule,
  };
}

/** Level annual mortgage payment — mirrors the engine's annual amortization
 *  (`_annual_payment`), so the derived liability row matches what's simulated. */
export function annualPayment(principal: number, annualRate: number, termYears: number): number {
  if (principal <= 0 || termYears <= 0) return 0;
  if (annualRate <= 1e-12) return principal / termYears;
  return (principal * annualRate) / (1 - Math.pow(1 + annualRate, -termYears));
}

// ---- Derived primitives the Housing config generates, in today's dollars ----
// These mirror what the engine derives inside the simulation (the mortgage, the
// purchase/sale events, and the carrying-cost streams). They are surfaced as
// READ-ONLY rows in the Accounts / Cash Flow tabs so the home shows up everywhere
// it should, while staying owned by the Housing config — the tabs can't drift.

export interface DerivedMortgage {
  loanToday: number; rate: number; annualPaymentToday: number;
  startAge: number; payoffAge: number;
}
export interface DerivedExpense {
  name: string; annualToday: number; startAge: number; endAge: number;
}
export interface DerivedEvent { name: string; age: number; outflow: boolean }
export interface DerivedHousing {
  mortgage: DerivedMortgage;
  expenses: DerivedExpense[];
  events: DerivedEvent[];
}

/** What a HousingConfig generates, in today's dollars, for read-only display in
 *  the other tabs. `null` when housing is disabled. Mirrors the engine's
 *  `_housing_schedule` / `_expand_housing_streams` (carrying costs begin the year
 *  after purchase, when payments start). */
export function housingDerived(
  h: { enabled: boolean; purchase_age: number; home_price: number; down_payment_pct: number;
       mortgage_rate: number; loan_term_years: number; loan_type: "fixed" | "arm";
       arm_fixed_years: number; arm_reset_rate: number; points: number;
       property_tax_rate: number; insurance_annual: number; maintenance_pct: number;
       pmi_rate: number; sale_age?: number | null },
  startAge: number, horizonAge: number,
): DerivedHousing | null {
  if (!h.enabled) return null;
  const buyAge = Math.max(h.purchase_age, startAge);
  const loan = h.home_price * (1 - h.down_payment_pct);
  const amort = amortize({
    price: h.home_price, downPct: h.down_payment_pct, rate: h.mortgage_rate,
    termYears: h.loan_term_years, type: h.loan_type, armFixedYears: h.arm_fixed_years,
    armResetRate: h.arm_reset_rate, points: h.points,
  });
  const ownAge = buyAge + 1; // carrying costs + payments begin the year after purchase
  const lastAge = h.sale_age != null && h.sale_age > ownAge ? h.sale_age - 1 : horizonAge;
  const mortgage: DerivedMortgage = {
    loanToday: loan, rate: h.mortgage_rate,
    annualPaymentToday: annualPayment(loan, h.mortgage_rate, h.loan_term_years),
    startAge: buyAge, payoffAge: buyAge + amort.payoffYear,
  };
  const expenses: DerivedExpense[] = [
    { name: "Property Tax", annualToday: h.property_tax_rate * h.home_price, startAge: ownAge, endAge: lastAge },
    { name: "Home Insurance", annualToday: h.insurance_annual, startAge: ownAge, endAge: lastAge },
    { name: "Home Maintenance", annualToday: h.maintenance_pct * h.home_price, startAge: ownAge, endAge: lastAge },
  ];
  if (h.down_payment_pct < 0.2 && h.pmi_rate > 0) {
    expenses.push({ name: "PMI", annualToday: h.pmi_rate * loan, startAge: ownAge, endAge: lastAge });
  }
  const events: DerivedEvent[] = [{ name: "Buy Home", age: buyAge, outflow: true }];
  if (h.sale_age != null && h.sale_age > buyAge) {
    events.push({ name: "Sell Home", age: h.sale_age, outflow: false });
  }
  return { mortgage, expenses, events };
}

export interface RentVsBuyInput {
  price: number; // today's $
  downPct: number;
  closingPct: number;
  rate: number;
  termYears: number;
  propertyTaxRate: number;
  insuranceAnnual: number; // today's $
  maintenancePct: number;
  appreciationReal: number; // real home appreciation over inflation
  inflation: number; // CPI mean
  investReturnReal: number; // real return on the invested alternative
  monthlyRent: number; // today's $
  rentGrowthReal?: number; // real rent growth (default 0)
  sellingCostsPct: number;
  years: number; // comparison horizon
}

export interface RentVsBuyResult {
  buyWealthReal: number[]; // net real wealth if buying (sellable equity + side investments), by year 0..years
  rentWealthReal: number[]; // net real wealth if renting and investing the difference
  breakEvenYear: number | null; // first year buying overtakes renting (null = never within horizon)
}

/** Net-worth rent-vs-buy: both start with the same cash (down + closing). The
 *  buyer sinks it into the home and pays ownership costs; the renter invests it
 *  and pays rent. Each year the cheaper party invests the cost difference, so
 *  total outlay is matched. Computed nominally, reported in today's dollars. */
export function rentVsBuy(p: RentVsBuyInput): RentVsBuyResult {
  const g = (1 + p.inflation) * (1 + p.appreciationReal) - 1; // nominal home appreciation
  const rentG = (1 + p.inflation) * (1 + (p.rentGrowthReal ?? 0)) - 1; // nominal rent growth
  const invR = (1 + p.inflation) * (1 + p.investReturnReal) - 1; // nominal invest return
  const loan = p.price * (1 - p.downPct);
  const upfront = p.price * p.downPct + p.price * p.closingPct;
  const pay = monthlyPayment(loan, p.rate, p.termYears);

  let bal = loan; // mortgage balance (nominal)
  let buySide = 0; // buyer's side investments when owning is cheaper than renting (nominal)
  let rentPort = upfront; // renter invests the avoided down + closing (nominal)

  const buyWealthReal: number[] = [];
  const rentWealthReal: number[] = [];
  let breakEvenYear: number | null = null;

  for (let y = 0; y <= p.years; y++) {
    const defl = Math.pow(1 + p.inflation, y);
    const homeVal = p.price * Math.pow(1 + g, y);
    const sellable = homeVal * (1 - p.sellingCostsPct) - bal; // equity net of selling costs
    const buyWealth = (sellable + buySide) / defl;
    const rentWealth = rentPort / defl;
    buyWealthReal.push(buyWealth);
    rentWealthReal.push(rentWealth);
    if (breakEvenYear === null && y > 0 && buyWealth >= rentWealth) breakEvenYear = y;

    if (y === p.years) break;
    // advance one year: ownership costs vs rent, invest the difference, then grow.
    const ownCost =
      pay * 12 +
      p.propertyTaxRate * homeVal +
      p.insuranceAnnual * Math.pow(1 + p.inflation, y) +
      p.maintenancePct * homeVal;
    const rentCost = p.monthlyRent * 12 * Math.pow(1 + rentG, y);
    const diff = ownCost - rentCost; // >0: owning costs more -> renter invests the surplus
    if (diff > 0) rentPort += diff;
    else buySide += -diff;

    // amortize the mortgage one year (monthly)
    for (let m = 0; m < 12 && bal > 1e-9; m++) {
      const interest = bal * (p.rate / 12);
      bal -= Math.min(pay - interest, bal);
    }
    bal = Math.max(bal, 0);
    rentPort *= 1 + invR;
    buySide *= 1 + invR;
  }
  return { buyWealthReal, rentWealthReal, breakEvenYear };
}
