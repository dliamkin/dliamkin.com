"""Fine-tune each candidate base model on the distilled medication-extraction
dataset, evaluate on the held-out test split exactly once, and emit the
size-vs-F1 decision table plus per-candidate training curves.

Usage (from ml/train, inside the uv venv):
    .venv/bin/python train.py                # all candidates in config.yaml
    .venv/bin/python train.py --only bert-mini

The test split is loaded but never used for model selection or early stopping -
val F1 drives `load_best_model_at_end`; test is touched only for the final
numbers. Seeded and reproducible.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import yaml
from transformers import (
    AutoModelForTokenClassification,
    AutoTokenizer,
    DataCollatorForTokenClassification,
    Trainer,
    TrainingArguments,
    set_seed,
)

from data import build_dataset, load_split
from labels import ID_TO_LABEL, LABEL_TO_ID, NUM_LABELS
from metrics import compute_metrics, per_entity_report

HERE = os.path.dirname(os.path.abspath(__file__))


def resolve(path: str) -> str:
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(HERE, path))


def measure_cpu_latency(model, tokenizer, notes: list[str], max_length: int) -> float:
    """Average single-note CPU inference latency (ms) - the fair analog of the
    browser WASM path, and the number that goes in the size-vs-F1 table."""
    model_cpu = model.to("cpu").eval()
    times: list[float] = []
    with torch.no_grad():
        for note in notes[:40]:
            enc = tokenizer(note, truncation=True, max_length=max_length, return_tensors="pt")
            t0 = time.perf_counter()
            model_cpu(**enc)
            times.append((time.perf_counter() - t0) * 1000)
    return float(np.median(times)) if times else 0.0


def save_curves(name: str, log_history: list[dict], docs_dir: str) -> None:
    epochs, train_loss, eval_loss, eval_f1 = [], [], [], []
    for entry in log_history:
        if "loss" in entry and "epoch" in entry and "eval_loss" not in entry:
            train_loss.append((entry["epoch"], entry["loss"]))
        if "eval_f1" in entry:
            epochs.append(entry["epoch"])
            eval_loss.append(entry.get("eval_loss"))
            eval_f1.append(entry["eval_f1"])

    os.makedirs(docs_dir, exist_ok=True)
    csv_path = os.path.join(docs_dir, f"training-curve-{name}.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["epoch", "eval_loss", "eval_f1"])
        for e, l, fscore in zip(epochs, eval_loss, eval_f1):
            w.writerow([e, l, fscore])

    fig, ax1 = plt.subplots(figsize=(7, 4))
    if train_loss:
        ax1.plot(*zip(*train_loss), label="train loss", color="tab:blue", alpha=0.6)
    if eval_loss and eval_loss[0] is not None:
        ax1.plot(epochs, eval_loss, label="val loss", color="tab:cyan")
    ax1.set_xlabel("epoch")
    ax1.set_ylabel("loss")
    ax2 = ax1.twinx()
    ax2.plot(epochs, eval_f1, label="val F1", color="tab:red")
    ax2.set_ylabel("val F1")
    ax2.set_ylim(0, 1)
    fig.suptitle(f"{name}: training curves")
    fig.legend(loc="upper right", bbox_to_anchor=(0.88, 0.88))
    fig.tight_layout()
    fig.savefig(os.path.join(docs_dir, f"training-curve-{name}.png"), dpi=120)
    plt.close(fig)


def train_candidate(candidate: dict, cfg: dict, data: dict) -> dict:
    name = candidate["name"]
    checkpoint = candidate["checkpoint"]
    hp = {**cfg["defaults"], **cfg.get("overrides", {}).get(name, {})}
    print(f"\n{'=' * 60}\nCandidate: {name}  ({checkpoint})\n  hyperparameters: {hp}\n{'=' * 60}")

    tokenizer = AutoTokenizer.from_pretrained(checkpoint)
    model = AutoModelForTokenClassification.from_pretrained(
        checkpoint,
        num_labels=NUM_LABELS,
        id2label={i: ID_TO_LABEL[i] for i in range(NUM_LABELS)},
        label2id=LABEL_TO_ID,
    )

    train_ds = build_dataset(data["train"], tokenizer, cfg["max_length"])
    val_ds = build_dataset(data["val"], tokenizer, cfg["max_length"])
    test_ds = build_dataset(data["test"], tokenizer, cfg["max_length"])
    collator = DataCollatorForTokenClassification(tokenizer)

    out_dir = os.path.join(resolve(cfg["output_dir"]), name)
    args = TrainingArguments(
        output_dir=out_dir,
        num_train_epochs=hp["epochs"],
        per_device_train_batch_size=hp["batch_size"],
        per_device_eval_batch_size=hp["batch_size"],
        learning_rate=float(hp["learning_rate"]),
        weight_decay=hp["weight_decay"],
        warmup_ratio=hp["warmup_ratio"],
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        greater_is_better=True,
        save_total_limit=1,
        seed=cfg["seed"],
        fp16=torch.cuda.is_available(),
        report_to="none",
        disable_tqdm=False,
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        data_collator=collator,
        compute_metrics=compute_metrics,
    )
    trainer.train()

    # Final numbers on the held-out test split - touched only here, once.
    test_pred = trainer.predict(test_ds)
    report = per_entity_report(test_pred.predictions, test_pred.label_ids)

    # Persist the best checkpoint + tokenizer for export_onnx.py.
    final_dir = os.path.join(out_dir, "final")
    trainer.save_model(final_dir)
    tokenizer.save_pretrained(final_dir)

    save_curves(name, trainer.state.log_history, resolve(cfg["docs_dir"]))
    latency_ms = measure_cpu_latency(model, tokenizer, [e["note"] for e in data["test"]], cfg["max_length"])
    params = sum(p.numel() for p in model.parameters())

    micro = report.get("micro avg", report.get("weighted avg", {}))
    return {
        "name": name,
        "checkpoint": checkpoint,
        "params_m": round(params / 1e6, 1),
        "int8_est_mb": round(params / 1e6, 1),  # ~1 byte/param; export measures the real ONNX size
        "test_f1": round(micro.get("f1-score", 0.0), 4),
        "test_precision": round(micro.get("precision", 0.0), 4),
        "test_recall": round(micro.get("recall", 0.0), 4),
        "cpu_latency_ms": round(latency_ms, 1),
        "per_entity": {
            k: {"precision": round(v["precision"], 3), "recall": round(v["recall"], 3), "f1": round(v["f1-score"], 3)}
            for k, v in report.items()
            if k in ("MED_NAME", "DOSE", "ROUTE", "FREQUENCY", "STATUS_CUE")
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=os.path.join(HERE, "config.yaml"))
    parser.add_argument("--only", default=None, help="train just this candidate name")
    cli = parser.parse_args()

    with open(cli.config) as f:
        cfg = yaml.safe_load(f)
    set_seed(cfg["seed"])

    data = {split: load_split(resolve(cfg["data_dir"]), split) for split in ("train", "val", "test")}
    print(f"Loaded splits - train {len(data['train'])}, val {len(data['val'])}, test {len(data['test'])}")

    candidates = cfg["candidates"]
    if cli.only:
        candidates = [c for c in candidates if c["name"] == cli.only]

    rows = [train_candidate(c, cfg, data) for c in candidates]

    # --- size-vs-F1 decision table -----------------------------------------
    docs_dir = resolve(cfg["docs_dir"])
    os.makedirs(docs_dir, exist_ok=True)
    with open(os.path.join(docs_dir, "size-vs-f1.json"), "w") as f:
        json.dump(rows, f, indent=2)

    header = f"\n{'candidate':<12}{'params(M)':>10}{'int8~MB':>9}{'test F1':>9}{'prec':>7}{'recall':>8}{'CPU ms':>8}"
    lines = [header, "-" * len(header)]
    for r in sorted(rows, key=lambda x: x["params_m"]):
        lines.append(
            f"{r['name']:<12}{r['params_m']:>10}{r['int8_est_mb']:>9}"
            f"{r['test_f1']:>9}{r['test_precision']:>7}{r['test_recall']:>8}{r['cpu_latency_ms']:>8}"
        )
    table = "\n".join(lines)
    print("\n=== SIZE vs F1 (held-out test split) ===")
    print(table)
    with open(os.path.join(docs_dir, "size-vs-f1.md"), "w") as f:
        f.write("# Size vs F1 - candidate comparison\n\n```\n" + table + "\n```\n")
    print(f"\nWrote table + curves to {docs_dir}")


if __name__ == "__main__":
    main()
