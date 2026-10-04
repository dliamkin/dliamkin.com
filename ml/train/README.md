# ml/train - student model training & ONNX export

Self-contained Python project that fine-tunes small token-classification models
on the distilled medication-extraction dataset (produced by `ml/datagen`),
picks a winner by the size-vs-F1 table, and exports it to int8 ONNX for
in-browser inference via transformers.js.

Runs in a **pinned Python 3.12 virtualenv managed by [uv](https://docs.astral.sh/uv/)**
- no conda, no system Python assumptions. torch's CUDA build is auto-selected
against the local driver (an RTX 2070 here); CPU also works, just slower.

## One-time setup

```bash
# from repo root
curl -LsSf https://astral.sh/uv/install.sh | sh        # if uv isn't installed
cd ml/train
uv venv --python 3.12 .venv
uv pip install --python .venv --torch-backend=auto -r requirements.txt
```

## The pipeline (end to end)

```
ml:generate-data   →   ml:train   →   ml:export   →   ml:eval-student
  (ml/datagen, TS)      (here)          (here)         (scripts/evals, TS)
```

From the repo root (npm wrappers call this venv's python):

```bash
npm run ml:train      # fine-tune every candidate, print the size-vs-F1 table,
                      #   write curves (PNG+CSV) to docs/internal/
npm run ml:export     # export config.export_candidate → public/models/med-extractor/
                      #   (fp32 + int8 ONNX, post-quant F1 delta, model-card.json)
```

Or directly:

```bash
.venv/bin/python train.py                 # all candidates
.venv/bin/python train.py --only bert-mini
.venv/bin/python export_onnx.py --candidate distilbert
.venv/bin/python -m pytest test_labels.py # BIO-scheme sync guard
```

## What lives where

| Path | Committed? | Purpose |
|---|---|---|
| `*.py`, `config.yaml`, `requirements.txt` | ✅ | the training code (the artifact) |
| `.venv/`, `outputs/` | ❌ gitignored | interpreter + checkpoints |
| `../data/*.jsonl` | ❌ gitignored | the dataset |
| `../../public/models/med-extractor/` | ✅ | the **shipped** int8 ONNX model |
| `../../docs/internal/` | ❌ gitignored (public repo) | curves, tables, model card |

## Reproducibility

`config.yaml` pins the seed, base checkpoints, and per-candidate
hyperparameters. The **test split is never used for model selection** - val F1
drives `load_best_model_at_end`; test is scored exactly once at the end. The BIO
label order is fixed and asserted against the TypeScript scheme by
`test_labels.py`.
