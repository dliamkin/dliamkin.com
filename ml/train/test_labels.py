"""Guard test: the Python BIO label ordering MUST match
src/lib/med-extractor/labels.ts exactly, because the index order is baked into
the exported ONNX id2label and decoded positionally in the browser. If this
fails, the two files have drifted and a re-export would mis-decode.

Run: .venv/bin/python -m pytest test_labels.py   (or plain: python test_labels.py)
"""

from labels import BIO_LABELS, LABEL_TO_ID, NUM_LABELS

# The exact expected order, mirroring the TS `BIO_LABELS` constant.
EXPECTED = [
    "O",
    "B-MED_NAME", "I-MED_NAME",
    "B-DOSE", "I-DOSE",
    "B-ROUTE", "I-ROUTE",
    "B-FREQUENCY", "I-FREQUENCY",
    "B-STATUS_CUE", "I-STATUS_CUE",
]


def test_label_order_matches_typescript():
    assert BIO_LABELS == EXPECTED, f"BIO_LABELS drifted from TS scheme:\n{BIO_LABELS}\n!=\n{EXPECTED}"
    assert NUM_LABELS == 11
    assert LABEL_TO_ID["O"] == 0
    assert LABEL_TO_ID["I-STATUS_CUE"] == 10


if __name__ == "__main__":
    test_label_order_matches_typescript()
    print("OK - Python BIO labels match the TypeScript scheme (11 labels).")
