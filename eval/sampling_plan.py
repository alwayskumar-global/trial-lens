"""Pre-registered stratified sampling for the annotation review (docs/eval-annotation-mapping.md section 10). PURE: counts and ids only, no file
access, no row text. Not run on real ids until Kumar approves the proposal.

allocate(): per-stratum sample sizes from the stratum row counts (deterministic; no randomness).
draw():     which row ids in a stratum, from a fixed seed (numpy.random.default_rng seeded with [seed, crc32(stratum key)] over SORTED ids).
"""
import zlib

import numpy as np

PARAMS = {"seed": 20261030, "budget": 240, "census_max": 15, "floor": 10, "empty_floor": 20}  # proposed; the final numbers go into the doc with the counts


def allocate(strata, budget, census_max=15, floor=10, empty_floor=20, empty_keys=frozenset()):
    """strata: {key: N_rows}. Returns {key: n_to_review}.

    1. Strata with N <= census_max are reviewed whole.
    2. Every other stratum gets at least `floor` rows (`empty_floor` if its key is in `empty_keys`, i.e. an empty/null/unknown evidence list: those are always sampled,
       never assumed), capped at N.
    3. The rest of the budget is shared in proportion to sqrt(N) among the non-census strata (largest remainder, ties by key), capped at N.
    Raises ValueError if the census and floors alone exceed the budget (never silently shrinks). The total never exceeds `budget`.
    """
    for k, n in strata.items():
        if not isinstance(n, int) or n < 0:
            raise ValueError("stratum counts must be non-negative integers")
    alloc = {k: 0 for k in strata}
    census = [k for k, n in strata.items() if 0 < n <= census_max]
    for k in census:
        alloc[k] = strata[k]
    rest = sorted(k for k, n in strata.items() if n > census_max)
    for k in rest:
        alloc[k] = min(strata[k], empty_floor if k in empty_keys else floor)
    used = sum(alloc.values())
    if used > budget:
        raise ValueError(f"census plus floors need {used} rows, over the budget of {budget}")
    left = budget - used
    while left > 0:
        open_keys = [k for k in rest if alloc[k] < strata[k]]
        if not open_keys:
            break
        w = {k: float(strata[k]) ** 0.5 for k in open_keys}
        tot = sum(w.values())
        raw = {k: left * w[k] / tot for k in open_keys}
        add = {k: min(int(raw[k]), strata[k] - alloc[k]) for k in open_keys}
        spent = sum(add.values())
        if spent == 0:  # hand out the remainder one row at a time, largest fractional part first, ties by key
            for k in sorted(open_keys, key=lambda k: (-(raw[k] - int(raw[k])), k))[:left]:
                add[k] = 1
            spent = sum(add.values())
        for k, v in add.items():
            alloc[k] += v
        left -= spent
    assert sum(alloc.values()) <= budget
    return alloc


def draw(ids, n, seed, stratum_key):
    """Row ids (strings or ints) to review from one stratum: the ids are sorted first, then n are chosen without replacement."""
    ids = sorted(ids)
    if n >= len(ids):
        return list(ids)
    rng = np.random.default_rng([seed, zlib.crc32(str(stratum_key).encode("utf8"))])
    picked = rng.permutation(len(ids))[:n]
    return [ids[i] for i in sorted(picked.tolist())]
