"""Apply ANALYSIS_PLAN.md section 5 to everything in results/runs/.

Writes:
  results/summary.csv, results/comparisons.csv
  results/REPORT.md   (human-readable, with the wording each result is allowed)

Paired differences use the corrected resampled t-test for repeated k-fold CV
(Nadeau & Bengio, 2003): var = (1/J + n_test/n_train) * s^2, df = J - 1.

Usage: python compare.py [--results-dir results/smoke]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats.contingency import association

import config as C

PAIRS = [  # (rule, A, B, note)   difference = A - B, grouped protocol
    ("R1", "C2", "C1", "scaling on vs off (same 30 features, same folds)"),
    ("R1", "C2", "C3", "30 vs 26 features (both scaled)"),
    ("R2", "C2", "C7", "PRIMARY: SVM vs CRNN, both see the full clip"),
    ("R2", "C2", "C6", "SVM (full clip) vs CRNN (1.5 s), as in the submitted paper"),
    ("R2", "C5", "C7", "RF vs CRNN, both full clip"),
    ("R2", "C8", "C6", "SVM vs CRNN, both 1.5 s"),
    ("R2", "C5", "C2", "RF vs SVM"),
    ("R5", "A1", "C2", "SVM + SMOTE"),
    ("R5", "A3", "C2", "SVM + audio augmentation"),
    ("R5", "A5", "C2", "SVM + SMOTE + audio augmentation"),
    ("R5", "A2", "C5", "RF + SMOTE"),
    ("R5", "A4", "C5", "RF + audio augmentation"),
    ("R5", "A6", "C5", "RF + SMOTE + audio augmentation"),
    ("R5", "A7", "C6", "CRNN + SpecAugment"),
    ("B2", "B2_C2", "C2", "SVM with 1.8 kHz low-pass vs without"),
    ("B2", "B2_C5", "C5", "RF with low-pass vs without"),
    ("B2", "B2_C6", "C6", "CRNN with low-pass vs without"),
]


def md_table(df: pd.DataFrame, index: bool = True) -> str:
    """Markdown table without the optional 'tabulate' dependency."""
    d = df.reset_index() if index else df
    fmt = lambda v: f"{v:.3f}" if isinstance(v, (float, np.floating)) else str(v)
    rows = ["| " + " | ".join(map(str, d.columns)) + " |", "|" + "---|" * len(d.columns)]
    rows += ["| " + " | ".join(fmt(v) for v in r) + " |" for r in d.itertuples(index=False)]
    return "\n".join(rows)


def load_runs() -> pd.DataFrame:
    files = sorted((C.RESULTS / "runs").glob("*.csv"))
    if not files:
        raise SystemExit("No results in results/runs/. Run the experiments first.")
    return pd.concat([pd.read_csv(f) for f in files], ignore_index=True)


def nb_test(d: np.ndarray, n_train: float, n_test: float):
    J = len(d)
    mean = d.mean()
    se = np.sqrt((1 / J + n_test / n_train) * d.var(ddof=1)) if J > 1 else np.nan
    tcrit = stats.t.ppf(0.975, J - 1) if J > 1 else np.nan
    p = 2 * stats.t.sf(abs(mean / se), J - 1) if se and se > 0 else np.nan
    return mean, mean - tcrit * se, mean + tcrit * se, p


def verdict(a: str, b: str, lo: float, hi: float) -> str:
    """Wording rules R2 / R5, fixed before any result was seen."""
    within = -C.DELTA <= lo and hi <= C.DELTA
    if lo > 0 or hi < 0:
        winner, loser = (a, b) if lo > 0 else (b, a)
        return f"{winner} outperforms {loser}" + (f" (difference within ±{C.DELTA})" if within else "")
    if within:
        return "comparable"
    return "inconclusive"


def main() -> None:
    # The report uses δ, ±, − and Cramér; a cp1252 console would raise on print.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--results-dir", type=Path, default=C.RESULTS)
    C.RESULTS = ap.parse_args().results_dir
    runs = load_runs()
    recall_cols = [f"recall_{c}" for c in C.CLASSES]

    # ------------------------------------------------ summary
    g = runs.groupby(["config", "protocol"])
    summary = g.agg(runs=("macro_recall", "size"), macro_recall_mean=("macro_recall", "mean"),
                    macro_recall_sd=("macro_recall", "std"), macro_f1_mean=("macro_f1", "mean"),
                    accuracy_mean=("accuracy", "mean"),
                    **{f"{c}_mean": (c, "mean") for c in recall_cols}).reset_index()
    summary.to_csv(C.RESULTS / "summary.csv", index=False)

    # ------------------------------------------------ paired comparisons (grouped)
    grouped = runs[runs.protocol == "grouped"]
    comp = []
    for rule, a, b, note in PAIRS:
        ra, rb = grouped[grouped.config == a], grouped[grouped.config == b]
        if ra.empty or rb.empty:
            comp.append(dict(rule=rule, A=a, B=b, note=note, status="missing results"))
            continue
        j = ra.merge(rb, on=["repeat", "fold"], suffixes=("_a", "_b"))
        d = (j.macro_recall_a - j.macro_recall_b).to_numpy()
        n_tr, n_te = j.n_train_a.mean(), j.n_test_a.mean()
        mean, lo, hi, p = nb_test(d, n_tr, n_te)
        comp.append(dict(rule=rule, A=a, B=b, note=note, status="ok", pairs=len(d),
                         mean_A=j.macro_recall_a.mean(), mean_B=j.macro_recall_b.mean(),
                         diff=mean, ci_low=lo, ci_high=hi, p=p, verdict=verdict(a, b, lo, hi)))
    comp = pd.DataFrame(comp)
    comp.to_csv(C.RESULTS / "comparisons.csv", index=False)

    # ------------------------------------------------ R3 leakage gap
    piv = summary.pivot(index="config", columns="protocol", values="macro_recall_mean")
    gap = (piv.dropna().assign(gap_clip_minus_grouped=lambda t: t["clip"] - t["grouped"])
           if {"clip", "grouped"} <= set(piv.columns) else pd.DataFrame())

    # ------------------------------------------------ R4 sampling-rate shortcut
    man = pd.read_csv(C.MANIFEST)
    man = man[man.status == "ok"]
    rate_tab = pd.crosstab(man.native_sr, man.label)
    cramers_v = (float(association(rate_tab.to_numpy(), method="cramer"))
                 if rate_tab.shape[0] > 1 else 0.0)
    probes = summary[(summary.protocol == "grouped") & summary.config.isin(["B0", "B1"])]
    b2 = comp[(comp.rule == "B2") & (comp.status == "ok")]
    b2_hurts = b2[b2.ci_high < -C.DELTA]
    triggered = cramers_v >= C.CRAMERS_V_THRESHOLD or len(b2_hurts) > 0

    # recall by native sample rate (grouped protocol, pooled out-of-fold predictions)
    by_rate = []
    pred_files = sorted((C.RESULTS / "preds").glob("*__grouped__*.csv"))
    if pred_files:
        sr = man.set_index("file_id").native_sr
        for pf in pred_files:
            p = pd.read_csv(pf)
            p["native_sr"] = p.file_id.map(sr)
            cfg = pf.name.split("__")[0]
            for rate, d in p.groupby("native_sr"):
                rec = [(d.y_pred[d.y_true == i] == i).mean() for i in range(len(C.CLASSES)) if (d.y_true == i).any()]
                by_rate.append(dict(config=cfg, native_sr=int(rate), clips=len(d), macro_recall=np.mean(rec)))
        by_rate = (pd.DataFrame(by_rate).groupby(["config", "native_sr"])
                   .agg(clip_preds=("clips", "sum"), macro_recall=("macro_recall", "mean")).reset_index())

    # ------------------------------------------------ report
    f = lambda x: "" if pd.isna(x) else f"{x:.3f}"
    L = ["# Results report (generated by compare.py; do not edit by hand)", ""]
    L += ["## Summary (mean ± SD macro recall over runs)", "",
          "| config | protocol | runs | macro recall | " + " | ".join(C.DISPLAY[c] for c in C.CLASSES) + " |",
          "|---|---|---|---|" + "---|" * len(C.CLASSES)]
    for _, r in summary.sort_values(["protocol", "config"]).iterrows():
        L.append(f"| {r.config} | {r.protocol} | {r.runs} | {f(r.macro_recall_mean)} ± {f(r.macro_recall_sd)} | "
                 + " | ".join(f(r[f'recall_{c}_mean']) for c in C.CLASSES) + " |")
    L += ["", f"## Paired comparisons, grouped protocol (δ = {C.DELTA})", "",
          "| rule | A − B | note | diff | 95% CI | p | verdict |", "|---|---|---|---|---|---|---|"]
    for _, r in comp.iterrows():
        if r.status != "ok":
            L.append(f"| {r.rule} | {r.A} − {r.B} | {r.note} | | | | {r.status} |")
        else:
            L.append(f"| {r.rule} | {r.A} − {r.B} | {r.note} | {r['diff']:+.3f} | "
                     f"[{r.ci_low:+.3f}, {r.ci_high:+.3f}] | {f(r.p)} | {r.verdict} |")
    L += ["", "## R3 leakage gap (clip-level minus grouped, mean macro recall)", ""]
    L += [md_table(gap) if len(gap) else "Needs both protocols."]
    L += ["", "## R4 sampling-rate shortcut", "",
          "Native sample rate x label:", "", md_table(rate_tab), "",
          f"Cramér's V = {cramers_v:.3f} (threshold {C.CRAMERS_V_THRESHOLD})", "",
          f"Low-pass comparisons with the whole CI below −{C.DELTA}: "
          + (", ".join(f"{r.A} vs {r.B}" for r in b2_hurts.itertuples()) or "none"), "",
          ("**R4 TRIGGERED**: the abstract must say recording-source cues predict class, and B2 results "
           "go in the main text next to the primary results." if triggered else
           "R4 not triggered: B2 goes to the appendix with one sentence in the main text."), "",
          "Descriptive probes (B0 can predict at most as many classes as there are distinct rates, so its "
          f"ceiling here is {min(rate_tab.shape[0], len(C.CLASSES)) / len(C.CLASSES):.2f}):", "",
          md_table(probes[["config", "macro_recall_mean", "macro_recall_sd"]], index=False)
          if len(probes) else "B0/B1 not run.", "",
          "Recall by native sample rate (grouped, pooled out-of-fold). A large gap between rates for the "
          "same model is a warning sign:", "",
          md_table(by_rate, index=False) if len(by_rate) else "No prediction files."]
    L += ["", "R1 reminder: whatever the size of C2 − C1, describe it as a missing preprocessing step in a "
          "baseline, not as a finding about architectures."]

    # ------------------------------------------------ R6 title (chosen after results; must follow R1-R5)
    r2 = comp[(comp.rule == "R2") & (comp.A == "C2") & (comp.B == "C7")]
    r1 = comp[(comp.rule == "R1") & (comp.A == "C2") & (comp.B == "C1")]
    L += ["", "## R6 title and headline", ""]
    if len(r1) and r1.iloc[0].get("status") == "ok":
        L.append(f"R1 (C2 − C1): {r1.iloc[0].verdict}. Describe as a missing preprocessing step, not an architecture finding.")
    if len(r2) and r2.iloc[0].get("status") == "ok":
        L.append(f"R2 primary (C2 − C7): {r2.iloc[0].verdict}. The title must not claim that scaling beats architecture, "
                 "or that either model outperforms the other.")
    L.append("R4 is triggered (see above), so the abstract must also state that recording-source cues predict class.")
    L.append("Allowed framing: scaling is a large, decisive preprocessing effect; architecture choice is "
             "inconclusive on the matched-window comparison; clip-level evaluation inflates recall; "
             "no tested augmentation has a measurable effect.")

    lat_path = C.RESULTS / "latency_summary.csv"
    L += ["", "## Latency and footprint (C2, C5, C6; single-clip, CPU)", ""]
    if lat_path.exists():
        lat = pd.read_csv(lat_path)
        L += [md_table(lat, index=False), ""]
        machine = C.RESULTS / "machine.json"
        if machine.exists():
            info = json.loads(machine.read_text(encoding="utf-8"))
            cpu = info.get("cpu_name") or info.get("processor")
            L.append(f"Measured on {cpu}, {info.get('ram_gb')} GB RAM, {info.get('platform')}, "
                     f"cuda={info.get('cuda')}. n = {int(lat.n.iloc[0])} clips after warmup; times in milliseconds.")
            fp = info.get("footprint", {})
            L.append(f"Installed package directories: sklearn-only stack {fp.get('sklearn_only_mb')} MB; "
                     f"same stack plus PyTorch {fp.get('sklearn_plus_torch_mb')} MB "
                     f"(torch itself {fp.get('torch_mb')} MB).")
    else:
        L.append("Not yet measured. Run `python measure_latency.py`.")

    # encoding is explicit: the report contains δ, ±, − and Cramér, which Windows' default cp1252 cannot encode.
    (C.RESULTS / "REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
