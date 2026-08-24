#!/usr/bin/env python3
"""Generates packages/validation/src/mc-moments-fixture.json (P6.06).

P6.06's validation criterion is "matches offline numpy on fixture to 1e-10
(mean/var), quantile +-0.5%". This script IS the offline numpy half: it draws a
deterministic sample, computes the reference moments and percentiles with numpy,
and writes both the sample and the references to a committed JSON file that
packages/validation/src/mc-moments-numpy.test.ts reads.

The sample is committed rather than regenerated in TypeScript on the fly,
because the criterion is agreement with numpy on the SAME values -- reproducing
numpy's Mersenne Twister in TypeScript would be testing an RNG port, not the
estimators. Every float is written with repr(), which round-trips exactly
through both json.load and JSON.parse.

Requires numpy. Re-run only if the fixture needs to change, and say so in the
changelog if you do: the reference numbers are the thing under test.

    python3 scripts/generate-mc-moments-fixture.py
"""

import json
import os

import numpy as np

QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95]


def build_sample() -> dict:
    """Three columns, each a shape a Monte Carlo observable actually takes.

    - `range`: normal, wide spread relative to the mean. The easy case.
    - `impactSpeed`: normal with a mean 600x its standard deviation. This is
      the catastrophic-cancellation shape: sumSquares/n is ~9e2 against a
      variance of ~2.5e-3, so the textbook `(sumSquares - sum^2/n)/(n-1)`
      loses five leading digits before it starts.
    - `apexHeight`: lognormal, strongly right-skewed, so the quantile
      estimator is graded somewhere its five markers are not evenly spaced.
    """
    rng = np.random.default_rng(20260824)
    n = 4096
    return {
        "range": rng.normal(1850.0, 45.0, n),
        "impactSpeed": rng.normal(30.0, 0.05, n),
        "apexHeight": rng.lognormal(mean=np.log(420.0), sigma=0.35, size=n),
    }


def main() -> None:
    columns = build_sample()
    out = {
        "generatedBy": "scripts/generate-mc-moments-fixture.py",
        "numpyVersion": np.__version__,
        "quantiles": QUANTILES,
        "columns": {},
    }
    for name, values in columns.items():
        out["columns"][name] = {
            "values": [float(v) for v in values],
            "count": int(values.size),
            # ddof=1 is the sample variance -- the same Bessel correction
            # WelfordAccumulator.variance applies. ddof=0 is included so a
            # convention mismatch shows up as "matches the other one" rather
            # than as an unexplained failure.
            "mean": float(np.mean(values)),
            "varianceSample": float(np.var(values, ddof=1)),
            "variancePopulation": float(np.var(values, ddof=0)),
            "stdSample": float(np.std(values, ddof=1)),
            # numpy's default interpolation is "linear": h = p (n - 1).
            "percentiles": [
                float(np.quantile(values, q, method="linear")) for q in QUANTILES
            ],
        }

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "packages", "validation", "src", "mc-moments-fixture.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(out, handle, indent=1)
        handle.write("\n")
    print(f"wrote {path} ({sum(c['count'] for c in out['columns'].values())} values)")


if __name__ == "__main__":
    main()
