#!/usr/bin/env bash
# End-to-end smoke test on synthetic data, in a throwaway copy of experiments/.
# Classical configs run at full settings on 2 repeats; the CRNN runs 2 epochs on 1 repeat.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-/tmp/rs_smoke}"
rm -rf "$WORK" && mkdir -p "$WORK" && cp -r "$SRC"/*.py "$SRC"/tests "$WORK"/
cd "$WORK"
python tests/make_synthetic.py --out data/raw_synth
python build_manifest.py --audio-root data/raw_synth --handover-csv data/raw_synth/metadata_handover.csv
python extract_features.py --n-jobs "${N_JOBS:-1}"
python run_classical.py --configs all --protocols grouped clip --repeats 0 1
# CRNN smoke results go to results/smoke/; copy the classical runs next to them so compare sees everything
python run_crnn.py --configs C6 C7 A7 B2_C6 --protocol grouped --repeats 0 --max-epochs 2
python run_crnn.py --configs C6 --protocol clip --repeats 0 --max-epochs 2
mkdir -p results/smoke/runs && cp results/runs/*.csv results/smoke/runs/
python compare.py --results-dir results/smoke
echo "SMOKE TEST PASSED ($WORK)"
