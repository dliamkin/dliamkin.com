"""Token-classification metrics via seqeval - entity-level (span) precision,
recall, and F1, not per-token accuracy. Entity-level is the honest measure:
getting 4 of 5 subwords of a drug name right is still a wrong extraction.
"""

from __future__ import annotations

import numpy as np
from seqeval.metrics import classification_report, f1_score, precision_score, recall_score

from labels import ID_TO_LABEL


def decode(predictions: np.ndarray, label_ids: np.ndarray) -> tuple[list[list[str]], list[list[str]]]:
    """Argmax predictions and gold ids → BIO label-string sequences, dropping
    the -100 positions (special tokens / continuation-subword ignores)."""
    preds = np.argmax(predictions, axis=-1)
    true_labels: list[list[str]] = []
    true_preds: list[list[str]] = []
    for pred_row, label_row in zip(preds, label_ids):
        row_labels: list[str] = []
        row_preds: list[str] = []
        for p, l in zip(pred_row, label_row):
            if l == -100:
                continue
            row_labels.append(ID_TO_LABEL[int(l)])
            row_preds.append(ID_TO_LABEL[int(p)])
        true_labels.append(row_labels)
        true_preds.append(row_preds)
    return true_preds, true_labels


def compute_metrics(eval_pred) -> dict[str, float]:
    predictions, label_ids = eval_pred
    preds, labels = decode(predictions, label_ids)
    return {
        "precision": precision_score(labels, preds),
        "recall": recall_score(labels, preds),
        "f1": f1_score(labels, preds),
    }


def per_entity_report(predictions: np.ndarray, label_ids: np.ndarray) -> dict:
    """Full per-entity-type P/R/F1 table (used for the final test-split report)."""
    preds, labels = decode(predictions, label_ids)
    return classification_report(labels, preds, output_dict=True, zero_division=0)
