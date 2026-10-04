"""BIO label scheme for the medication extractor - the Python mirror of
src/lib/med-extractor/labels.ts. This ordering is load-bearing: the model's
id2label is baked into the exported ONNX config, and the browser decoder
(src/lib/med-extractor/decode.ts) maps logit argmax → label by this exact
index order. If you change one file you MUST change the other and re-export.
A guard test (test_labels_match) asserts the two stay in sync.
"""

ENTITY_TYPES = ["MED_NAME", "DOSE", "ROUTE", "FREQUENCY", "STATUS_CUE"]

# O, then B-/I- per entity type, in entity order. 11 labels, ids 0..10.
BIO_LABELS = ["O"]
for _t in ENTITY_TYPES:
    BIO_LABELS.append(f"B-{_t}")
    BIO_LABELS.append(f"I-{_t}")

LABEL_TO_ID = {label: i for i, label in enumerate(BIO_LABELS)}
ID_TO_LABEL = {i: label for i, label in enumerate(BIO_LABELS)}

NUM_LABELS = len(BIO_LABELS)
