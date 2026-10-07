#!/usr/bin/env python3
"""AGGREGATE-ONLY inspection of the TrialGPT criterion-annotation Parquet file (docs/eval-annotation-mapping.md).

It reads the file locally and prints/writes ONLY: sha256 and size, column names and Arrow types, row count, null counts, value counts for
label-like columns with at most 12 short distinct values, empty-versus-nonempty counts for the evidence-sentence column, and the cross-tab
label x criterion type x evidence-list presence x training value. It never prints a row, a note, trial text or criterion text. No model call,
no network. Needs pyarrow (install it in a scratch venv outside the repo; it is not a project dependency).

  python3 eval/inspect-annotations.py [path-to-parquet]     (default: eval/data/trialgpt-criterion-annotations/data/train-00000-of-00001.parquet)
  python3 eval/inspect-annotations.py --selftest            (synthetic table with sentinel text; asserts the sentinel never appears in the output)
"""
import hashlib
import json
import os
import re
import sys
from collections import Counter

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

DEFAULT = "eval/data/trialgpt-criterion-annotations/data/train-00000-of-00001.parquet"
OUT_NAME = "schema-aggregates.json"
MAX_DISTINCT, MAX_LEN = 12, 40
LABEL_LIKE = re.compile(r"label|eligib|training|split|cohort|corpus|dataset|annotator|crit.*type|inc.*exc|^type$", re.I)
ANNOTATOR = re.compile(r"annotator|physician|rater|reviewer|expert_?[a-d]\b|label_?[0-9]", re.I)
ID_LIKE = re.compile(r"(^|_)(id|nct|nctid|patient|trial|criterion|idx|index)(_|$)", re.I)
INCLUSION_LABELS = {"included", "not included"}
EXCLUSION_LABELS = {"excluded", "not excluded"}


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_values(col, name):
    """Value counts only for label-like columns with few short distinct values; otherwise just the distinct count."""
    if pa.types.is_nested(col.type):
        return {"distinct": "n/a (nested type)", "values": "withheld"}
    distinct = pc.count_distinct(col).as_py()
    if not LABEL_LIKE.search(name) or distinct > MAX_DISTINCT:
        return {"distinct": distinct, "values": "withheld"}
    counts = Counter(v.as_py() for v in col.combine_chunks()) if isinstance(col, pa.ChunkedArray) else Counter(v.as_py() for v in col)
    vals = list(counts)
    if any(isinstance(v, str) and (len(v) > MAX_LEN or "\n" in v) for v in vals):
        return {"distinct": distinct, "values": "withheld"}
    return {"distinct": distinct, "values": {("null" if v is None else str(v)): n for v, n in sorted(counts.items(), key=lambda kv: str(kv[0]))}}


def presence(col):
    """Per row: 'empty' (null, empty list, empty string) or 'nonempty'. Content is never returned."""
    t = col.type
    if pa.types.is_list(t) or pa.types.is_large_list(t):
        lengths = pc.fill_null(pc.list_value_length(col), 0)
        return ["nonempty" if n and n > 0 else "empty" for n in lengths.to_pylist()]
    if pa.types.is_string(t) or pa.types.is_large_string(t):
        s = pc.fill_null(pc.utf8_trim_whitespace(col), "")
        return ["nonempty" if x else "empty" for x in s.to_pylist()]
    return ["unsupported-type"] * len(col)


def find(names, pattern):
    return [n for n in names if re.search(pattern, n, re.I)]


def inspect_table(table, path_info):
    names = table.schema.names
    out = {"file": path_info, "rows": table.num_rows, "columns": {n: str(table.schema.field(n).type) for n in names}, "null_counts": {n: table.column(n).null_count for n in names}}
    out["value_counts"] = {n: safe_values(table.column(n), n) for n in names}
    label_col = "expert_eligibility" if "expert_eligibility" in names else None
    train_col = "training" if "training" in names else None
    ev_col = "expert_sentences" if "expert_sentences" in names else None
    out["named_fields_present"] = {"expert_eligibility": bool(label_col), "training": bool(train_col), "expert_sentences": bool(ev_col)}
    out["per_annotator_like_columns"] = [n for n in names if ANNOTATOR.search(n)]
    ids = [n for n in names if ID_LIKE.search(n) and not pa.types.is_nested(table.schema.field(n).type)]
    out["id_like_columns"] = {n: pc.count_distinct(table.column(n)).as_py() for n in ids}
    if ids:
        keys = list(zip(*[[str(x) for x in table.column(n).to_pylist()] for n in ids]))
        out["duplicate_rows_over_id_like_columns"] = len(keys) - len(set(keys))
    if ev_col:
        pres = presence(table.column(ev_col))
        out["evidence_presence"] = dict(Counter(pres))
    # criterion type: a column if one exists with <= 4 short values, else derived from the label vocabulary only
    type_cols = [n for n in find(names, r"crit.*type|inc.*exc|^type$") if safe_values(table.column(n), n).get("values") != "withheld" and isinstance(safe_values(table.column(n), n)["distinct"], int) and safe_values(table.column(n), n)["distinct"] <= 4]
    labels = table.column(label_col).to_pylist() if label_col else [None] * table.num_rows
    if type_cols:
        types = [str(x) for x in table.column(type_cols[0]).to_pylist()]
        out["criterion_type_source"] = f"column:{type_cols[0]}"
    else:
        types = ["inclusion" if l in INCLUSION_LABELS else "exclusion" if l in EXCLUSION_LABELS else "either" for l in labels]
        out["criterion_type_source"] = "derived from the label vocabulary (not enough information / not applicable shown as 'either')"
    pres_rows = pres if ev_col else ["no-evidence-column"] * table.num_rows
    train = [("null" if v is None else str(v)) for v in (table.column(train_col).to_pylist() if train_col else [None] * table.num_rows)] if train_col else ["no-training-column"] * table.num_rows
    lab_safe = out["value_counts"].get(label_col, {}).get("values") != "withheld" if label_col else False
    cross = Counter()
    for l, t, e, tr in zip(labels, types, pres_rows, train):
        cross[(str(l) if lab_safe else "withheld", t, e, tr)] += 1
    out["crosstab_label_type_evidence_training"] = [{"label": k[0], "type": k[1], "evidence": k[2], "training": k[3], "n": n} for k, n in sorted(cross.items())]
    return out


def selftest():
    sentinel = "SENTINEL-PATIENT-NOTE the patient denies chest pain and takes no medications"
    table = pa.table({
        "patient_id": ["p1", "p1", "p2", "p3"],
        "trial_id": ["NCT00000001", "NCT00000002", "NCT00000001", "NCT00000003"],
        "criterion_text": [sentinel + " criterion"] * 4,
        "patient_note": [sentinel] * 4,
        "expert_sentences": [[sentinel], [], [sentinel, sentinel], None],
        "expert_eligibility": ["included", "not included", "not excluded", "not enough information"],
        "training": [True, False, False, True],
    })
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        res = inspect_table(table, {"selftest": True})
        print(json.dumps(res, indent=1))
    text = buf.getvalue()
    assert "SENTINEL" not in text, "sentinel text leaked into the output"
    assert res["rows"] == 4
    assert res["evidence_presence"] == {"nonempty": 2, "empty": 2}, res["evidence_presence"]
    assert res["value_counts"]["training"]["values"] == {"False": 2, "True": 2}
    assert res["value_counts"]["criterion_text"]["values"] == "withheld"
    assert res["value_counts"]["patient_note"]["values"] == "withheld"
    assert res["value_counts"]["expert_eligibility"]["values"]["included"] == 1
    assert sum(r["n"] for r in res["crosstab_label_type_evidence_training"]) == 4
    assert res["per_annotator_like_columns"] == []
    print("selftest ok: aggregates correct, no sentinel text in the output")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    path = next((a for a in sys.argv[1:] if not a.startswith("--")), DEFAULT)
    if not os.path.exists(path):
        sys.exit(f"file not found: {path} (see docs/eval-annotation-mapping.md section 9)")
    apath = os.path.abspath(path)
    if os.sep + os.path.join("eval", "data") + os.sep not in apath:
        sys.exit("refusing to read a file outside eval/data/ (gitignored)")
    table = pq.read_table(path)
    res = inspect_table(table, {"name": os.path.basename(path), "bytes": os.path.getsize(path), "sha256": sha256_of(path)})
    text = json.dumps(res, indent=1)
    print(text)
    out = os.path.join(os.path.dirname(os.path.dirname(apath)), OUT_NAME)
    with open(out, "w") as f:
        f.write(text + "\n")
    print(f"\nwrote {os.path.relpath(out)} (gitignored; aggregates only)")


if __name__ == "__main__":
    main()
