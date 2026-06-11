"""Build the annual historical returns dataset from Robert Shiller's ie_data.xls.

Downloads (or reads a local copy of) Shiller's U.S. Stock Markets 1871-Present
spreadsheet and produces fire_engine/data/historical_annual.csv with calendar-year
(January-to-January) observations:

    year, stock_nominal, bond_nominal, inflation, stock_real, bond_real

Stock returns come from Shiller's Real Total Return Price index (col J), bond
returns from his Real Total Bond Returns index (col S), inflation from CPI.
Nominal returns are reconstructed as (1+real)*(1+inflation)-1 so all three
columns of a row are mutually consistent.

Usage:  python build_historical.py [path-to-ie_data.xls]
If no path is given, the file is downloaded from Yale.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import pandas as pd

SHILLER_URL = "http://www.econ.yale.edu/~shiller/data/ie_data.xls"
OUT_PATH = Path(__file__).resolve().parents[1] / "fire_engine" / "data" / "historical_annual.csv"

# Column positions in the "Data" sheet (header spans rows 0-7, data starts row 8)
COL_DATE = 0          # fractional date, 1871.01 = Jan 1871, 1871.1 = Oct 1871
COL_CPI = 4
COL_REAL_TR_PRICE = 9   # real total-return stock price index
COL_REAL_BOND_TR = 18   # real total-return bond index (starts at 1.0 in Jan 1871)


def month_from_fractional(date_val: float) -> int:
    """Shiller encodes months as .01...12, where .1 means October."""
    frac = round((date_val - int(date_val)) * 100)
    return 10 if frac == 10 else frac


def build(xls_path: Path) -> pd.DataFrame:
    raw = pd.read_excel(xls_path, sheet_name="Data", header=None, skiprows=8)
    raw = raw[[COL_DATE, COL_CPI, COL_REAL_TR_PRICE, COL_REAL_BOND_TR]].copy()
    raw.columns = ["date", "cpi", "stock_tr_real", "bond_tr_real"]
    raw = raw.dropna(subset=["date"])
    raw["year"] = raw["date"].astype(float).astype(int)
    raw["month"] = raw["date"].astype(float).map(month_from_fractional)

    jan = raw[raw["month"] == 1].dropna(subset=["cpi", "stock_tr_real", "bond_tr_real"])
    jan = jan.sort_values("year").set_index("year")

    years = []
    for y in jan.index[:-1]:
        if y + 1 not in jan.index:
            continue
        a, b = jan.loc[y], jan.loc[y + 1]
        inflation = b["cpi"] / a["cpi"] - 1.0
        stock_real = b["stock_tr_real"] / a["stock_tr_real"] - 1.0
        bond_real = b["bond_tr_real"] / a["bond_tr_real"] - 1.0
        years.append(
            {
                "year": y,
                "stock_nominal": (1 + stock_real) * (1 + inflation) - 1,
                "bond_nominal": (1 + bond_real) * (1 + inflation) - 1,
                "inflation": inflation,
                "stock_real": stock_real,
                "bond_real": bond_real,
            }
        )
    return pd.DataFrame(years)


def main() -> None:
    if len(sys.argv) > 1:
        xls_path = Path(sys.argv[1])
    else:
        xls_path = Path("ie_data.xls")
        print(f"Downloading {SHILLER_URL} ...")
        urllib.request.urlretrieve(SHILLER_URL, xls_path)

    df = build(xls_path)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_PATH, index=False, float_format="%.6f")

    real_cagr_stock = (1 + df["stock_real"]).prod() ** (1 / len(df)) - 1
    real_cagr_bond = (1 + df["bond_real"]).prod() ** (1 / len(df)) - 1
    print(f"Wrote {len(df)} years ({df['year'].min()}-{df['year'].max()}) to {OUT_PATH}")
    print(f"Real CAGR  stocks: {real_cagr_stock:.3%}  bonds: {real_cagr_bond:.3%}")
    print(f"Mean inflation: {df['inflation'].mean():.3%}")


if __name__ == "__main__":
    main()
