"""
Build per-unit (roadbed · county) distribution-aware yearly series for the
unit-level evolution pattern:

  Level  = mean over the unit's valid segments that year of the squared gap
           below 100 -- bad segments weigh disproportionately more.
  Spread = population std of the unit's valid segment scores that year --
           uniform unit ~ 0, mixed unit large.

See docs/superpowers/specs/2026-07-02-unit-evolution-distribution-design.md.
"""
import math

def level_of(scores):
    valid = [s for s in scores if s is not None and s >= 1]
    if not valid:
        return float("nan")
    return sum((100.0 - s) ** 2 for s in valid) / len(valid)

def spread_of(scores):
    valid = [s for s in scores if s is not None and s >= 1]
    if not valid:
        return float("nan")
    if len(valid) == 1:
        return 0.0
    mean = sum(valid) / len(valid)
    var = sum((s - mean) ** 2 for s in valid) / len(valid)
    return math.sqrt(var)
