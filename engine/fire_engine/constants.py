"""Domain constants shared across the engine — one home so a rule change lands
once instead of being hunted through several modules.

Age thresholds use the model's annual grain (see accounts.py / ASSUMPTIONS.md):
"59½" is implemented as the year the simulated person turns 60.
"""

# --- Age thresholds -------------------------------------------------------
PENALTY_FREE_AGE = 60           # annual-grain stand-in for 59.5: traditional and
                                # Roth earnings become penalty-free this year
HSA_PENALTY_FREE_AGE = 65       # HSA non-medical withdrawals become penalty-free
RMD_START_AGE = 75              # forced minimum distributions (SECURE 2.0, born 1960+)

# --- Roth conversion ladder ----------------------------------------------
CONVERSION_SEASONING_YEARS = 5  # conversion principal seasons 5 tax years
LADDER_DEFAULT_END_AGE = 72     # default end age for the conversion ladder

# --- FIRE rule of thumb ---------------------------------------------------
FIRE_MULTIPLE = 25.0            # 1 / 0.04 safe-withdrawal-rate; the "25× expenses" rule
