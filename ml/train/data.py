"""Dataset loading and label alignment for token-classification training.

The JSONL examples from ml/datagen carry the note text plus character-span
entities. Here we tokenize each note with the model's own tokenizer (with
offset mapping) and project the char spans onto subword tokens as BIO labels:
the first subword of an entity gets B-<TYPE>, continuation subwords get
I-<TYPE>, everything else O, and special tokens get -100 (ignored by the loss).
This is the standard, tokenizer-agnostic alignment - the same char-span
representation the browser runtime decodes back into at inference time.
"""

from __future__ import annotations

import json
import os
from typing import Any

from datasets import Dataset

from labels import LABEL_TO_ID


def load_split(data_dir: str, split: str) -> list[dict[str, Any]]:
    path = os.path.join(data_dir, f"{split}.jsonl")
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _entity_at(char_index: int, entities: list[dict[str, Any]]) -> dict[str, Any] | None:
    for ent in entities:
        if ent["start"] <= char_index < ent["end"]:
            return ent
    return None


def align_labels(offsets: list[tuple[int, int]], entities: list[dict[str, Any]]) -> list[int]:
    """Map subword offset spans to BIO label ids. -100 for special tokens."""
    labels: list[int] = []
    prev_entity_key: tuple[int, int] | None = None
    for start, end in offsets:
        if start == end:  # special token ([CLS]/[SEP]/pad) - offset (0,0)
            labels.append(-100)
            prev_entity_key = None
            continue
        ent = _entity_at(start, entities)
        if ent is None:
            labels.append(LABEL_TO_ID["O"])
            prev_entity_key = None
            continue
        key = (ent["start"], ent["end"])
        prefix = "I" if key == prev_entity_key else "B"
        labels.append(LABEL_TO_ID[f"{prefix}-{ent['type']}"])
        prev_entity_key = key
    return labels


def build_dataset(examples: list[dict[str, Any]], tokenizer, max_length: int) -> Dataset:
    def encode(example: dict[str, Any]) -> dict[str, Any]:
        enc = tokenizer(
            example["note"],
            truncation=True,
            max_length=max_length,
            return_offsets_mapping=True,
        )
        enc["labels"] = align_labels(enc["offset_mapping"], example["entities"])
        enc.pop("offset_mapping")
        return enc

    ds = Dataset.from_list(examples)
    # Encode row-by-row (not batched) so offset mapping stays per-example simple.
    return ds.map(encode, remove_columns=ds.column_names)
