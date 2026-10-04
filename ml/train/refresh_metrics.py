"""Refresh the auto sections of docs/internal/05-costs-and-metrics.md from the
build artifacts: ml/data/dataset-stats.json and
public/models/med-extractor/model-card.json.

Only the blocks between the AUTO markers are rewritten; hand-written context is
preserved. Safe to run any time - sections whose artifact is missing show
"pending". Run:

    ml/train/.venv/bin/python ml/train/refresh_metrics.py
"""

from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "../.."))
STATS = os.path.join(ROOT, "ml/data/dataset-stats.json")
CARD = os.path.join(ROOT, "public/models/med-extractor/model-card.json")
DOC = os.path.join(ROOT, "docs/internal/05-costs-and-metrics.md")

# Mirror of ml/datagen/config.ts PRICING + EST_TOKENS (keep in sync).
PRICING = {"claude-haiku-4-5": (1.0, 5.0), "claude-sonnet-5": (3.0, 15.0)}
EST_TOKENS = {"generation": (700, 350), "labeling": (900, 450)}

BEGIN = "<!-- AUTO:BEGIN -->"
END = "<!-- AUTO:END -->"


def load(path: str) -> dict | None:
    return json.load(open(path)) if os.path.exists(path) else None


def cost(calls: int, model: str, kind: str) -> float:
    inp, out = EST_TOKENS[kind]
    pi, po = PRICING[model]
    return calls * (inp / 1e6 * pi + out / 1e6 * po)


def render(stats: dict | None, card: dict | None) -> str:
    lines = [BEGIN, ""]
    lines.append("### Dataset stats - _(auto)_")
    if stats:
        d = stats["discards"]
        lines += [
            "",
            "| stat | value |",
            "|---|---|",
            f"| kept examples | {stats['kept']} |",
            f"| attempts | {stats['attempts']} |",
            f"| discard rate | {stats['discard_rate'] * 100:.1f}% |",
            f"| name-unlocatable / near-dupe / eval-overlap / empty | {d['name-unlocatable']} / {d['near-duplicate']} / {d['eval-overlap']} / {d['empty-note']} |",
            f"| skipped ambiguous fields (kept) | {stats.get('skipped_ambiguous_fields', 0)} |",
            f"| zero-med hard negatives | {stats['zero_med_negatives']} |",
            f"| total entity spans | {stats['total_entity_spans']} |",
            f"| transient API failures | {stats.get('transient_api_failures', 0)} |",
            f"| splits (train/val/test) | {stats['splits']['train']}/{stats['splits']['val']}/{stats['splits']['test']} |",
        ]
        calls = stats["attempts"]
        gen = cost(calls, "claude-haiku-4-5", "generation")
        lab = cost(calls, "claude-sonnet-5", "labeling")
        lines += [
            "",
            "### Actual generation spend - _(auto, estimate from attempts)_",
            "",
            "| line | estimate |",
            "|---|---|",
            f"| generation (haiku, ~{calls} calls) | ${gen:.2f} |",
            f"| labeling (sonnet, ~{calls} calls) | ${lab:.2f} |",
            f"| **full-run total** | ${gen + lab:.2f} |",
        ]
    else:
        lines += ["", "_⟨pending: run `npm run ml:generate-data -- --confirm` then refresh⟩_"]

    lines += ["", "### Final model card - _(auto)_"]
    if card:
        lines += [
            "",
            "| field | value |",
            "|---|---|",
            f"| shipped candidate | {card['candidate']} |",
            f"| base checkpoint | `{card['base_checkpoint']}` |",
            f"| int8 ONNX size (MB) | {card['int8_onnx_mb']} |",
            f"| test F1 (fp32) | {card['test_f1_fp32']} |",
            f"| test F1 (int8) | {card['test_f1_int8']} |",
            f"| **quantization F1 delta** | {card['quantization_f1_delta']:+.4f} |",
            f"| model sha256 (eval version) | `{card['model_sha256'][:16]}…` |",
        ]
    else:
        lines += ["", "_⟨pending: run `npm run ml:export` then refresh⟩_"]

    lines += ["", END]
    return "\n".join(lines)


def main() -> None:
    stats, card = load(STATS), load(CARD)
    block = render(stats, card)
    text = open(DOC).read() if os.path.exists(DOC) else f"# 05 - Costs & metrics\n\n{BEGIN}\n{END}\n"
    if BEGIN in text and END in text:
        pre = text[: text.index(BEGIN)]
        post = text[text.index(END) + len(END):]
        text = pre + block + post
    else:
        text = text.rstrip() + "\n\n" + block + "\n"
    open(DOC, "w").write(text)
    print(f"Refreshed {DOC}")
    print(f"  dataset-stats.json: {'found' if stats else 'missing'}")
    print(f"  model-card.json:    {'found' if card else 'missing'}")


if __name__ == "__main__":
    main()
