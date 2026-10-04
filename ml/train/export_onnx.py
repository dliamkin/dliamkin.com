"""Export the chosen fine-tuned checkpoint to ONNX, apply int8 dynamic
quantization, measure the post-quantization F1 delta on the held-out test
split, and lay the files out the way transformers.js expects - into
public/models/med-extractor/ (the one part of ml/ that IS committed and
shipped).

Usage (from ml/train, inside the uv venv):
    .venv/bin/python export_onnx.py                 # uses config.export_candidate
    .venv/bin/python export_onnx.py --candidate distilbert

Output layout (transformers.js reads config/tokenizer at root, weights under onnx/):
    public/models/med-extractor/
      config.json  tokenizer.json  tokenizer_config.json  vocab.txt  ...
      onnx/model.onnx            (fp32)
      onnx/model_quantized.onnx  (int8 dynamic)
      model-card.json            (params, sizes, F1, quant delta, onnx sha256)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil

import numpy as np
import torch
import yaml
from optimum.onnxruntime import ORTModelForTokenClassification, ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from transformers import AutoTokenizer

from data import build_dataset, load_split
from metrics import per_entity_report

HERE = os.path.dirname(os.path.abspath(__file__))


def resolve(path: str) -> str:
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(HERE, path))


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def onnx_f1(onnx_dir: str, file_name: str, tokenizer, test: list[dict], max_length: int) -> float:
    """Run an ONNX model file over the test split and return entity-level F1."""
    model = ORTModelForTokenClassification.from_pretrained(onnx_dir, file_name=file_name)
    all_logits, all_labels = [], []
    ds = build_dataset(test, tokenizer, max_length)
    for row in ds:
        input_ids = torch.tensor([row["input_ids"]])
        attention_mask = torch.tensor([row["attention_mask"]])
        with torch.no_grad():
            logits = model(input_ids=input_ids, attention_mask=attention_mask).logits.numpy()[0]
        labels = np.array(row["labels"])
        all_logits.append(logits)
        all_labels.append(labels)
    # Pad to a common length for the report helper (it ignores -100 anyway).
    max_len = max(x.shape[0] for x in all_logits)
    logits_pad = np.stack([np.pad(x, ((0, max_len - x.shape[0]), (0, 0))) for x in all_logits])
    labels_pad = np.stack([np.pad(l, (0, max_len - l.shape[0]), constant_values=-100) for l in all_labels])
    report = per_entity_report(logits_pad, labels_pad)
    micro = report.get("micro avg", report.get("weighted avg", {}))
    return float(micro.get("f1-score", 0.0))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=os.path.join(HERE, "config.yaml"))
    parser.add_argument("--candidate", default=None)
    cli = parser.parse_args()

    with open(cli.config) as f:
        cfg = yaml.safe_load(f)
    candidate = cli.candidate or cfg["export_candidate"]
    print(f"Exporting candidate: {candidate}")

    final_dir = os.path.join(resolve(cfg["output_dir"]), candidate, "final")
    if not os.path.isdir(final_dir):
        raise SystemExit(f"No trained checkpoint at {final_dir} - run train.py first.")

    ship_dir = resolve("../../public/models/med-extractor")
    onnx_dir = os.path.join(ship_dir, "onnx")
    if os.path.isdir(ship_dir):
        shutil.rmtree(ship_dir)
    os.makedirs(onnx_dir, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(final_dir)

    # 1. fp32 ONNX export into a temp dir (optimum puts model.onnx + config there).
    tmp_export = os.path.join(resolve(cfg["output_dir"]), candidate, "onnx-export")
    ort_model = ORTModelForTokenClassification.from_pretrained(final_dir, export=True)
    ort_model.save_pretrained(tmp_export)
    tokenizer.save_pretrained(tmp_export)

    # 2. int8 dynamic quantization (per-channel off for widest ORT/wasm support).
    quantizer = ORTQuantizer.from_pretrained(tmp_export)
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False)
    quantizer.quantize(save_dir=tmp_export, quantization_config=qconfig)
    # optimum names the quantized file model_quantized.onnx by default.

    # 3. lay out for transformers.js: config/tokenizer at root, and ONLY the
    #    int8 weights under onnx/. The browser loads model_quantized.onnx
    #    (dtype "q8"); the fp32 model.onnx stays in the temp dir - used just
    #    below to measure the quantization F1 delta - so we don't commit a
    #    ~4x-larger file nothing serves.
    for fn in os.listdir(tmp_export):
        src = os.path.join(tmp_export, fn)
        if not os.path.isfile(src):
            continue
        if fn == "model_quantized.onnx":
            shutil.copy2(src, os.path.join(onnx_dir, fn))
        elif fn.endswith(".onnx") or fn.endswith(".onnx_data"):
            continue  # fp32 weights - not shipped
        else:
            shutil.copy2(src, os.path.join(ship_dir, fn))

    test = load_split(resolve(cfg["data_dir"]), "test")
    f1_fp32 = onnx_f1(tmp_export, "model.onnx", tokenizer, test, cfg["max_length"])
    f1_int8 = onnx_f1(tmp_export, "model_quantized.onnx", tokenizer, test, cfg["max_length"])

    fp32_mb = round(os.path.getsize(os.path.join(onnx_dir, "model.onnx")) / 1e6, 2)
    int8_mb = round(os.path.getsize(os.path.join(onnx_dir, "model_quantized.onnx")) / 1e6, 2)
    quant_hash = sha256(os.path.join(onnx_dir, "model_quantized.onnx"))

    card = {
        "candidate": candidate,
        "base_checkpoint": next(c["checkpoint"] for c in cfg["candidates"] if c["name"] == candidate),
        "fp32_onnx_mb": fp32_mb,
        "int8_onnx_mb": int8_mb,
        "test_f1_fp32": round(f1_fp32, 4),
        "test_f1_int8": round(f1_int8, 4),
        "quantization_f1_delta": round(f1_int8 - f1_fp32, 4),
        "model_sha256": quant_hash,
        "max_length": cfg["max_length"],
    }
    with open(os.path.join(ship_dir, "model-card.json"), "w") as f:
        json.dump(card, f, indent=2)
    # A copy for the private docs / metrics refresh.
    docs_dir = resolve(cfg["docs_dir"])
    os.makedirs(docs_dir, exist_ok=True)
    with open(os.path.join(docs_dir, "model-card.json"), "w") as f:
        json.dump(card, f, indent=2)

    print("\n=== EXPORT COMPLETE ===")
    print(json.dumps(card, indent=2))
    print(f"\nShipped model → {ship_dir}")
    print(f"Quantization F1 delta: {card['quantization_f1_delta']:+.4f} "
          f"({int8_mb} MB int8 vs {fp32_mb} MB fp32)")


if __name__ == "__main__":
    main()
