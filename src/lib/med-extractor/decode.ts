import { type BioLabel, type EntitySpan, type EntityType } from "./labels";

// BIO decoder: merge a per-token label sequence into entity char-spans. Shared
// by the browser runtime (which tags each subword token from model logits) and
// any offline check. Char-offset based, so it is tokenizer-independent - the
// caller supplies each token's [start, end) offset into the note and its
// predicted BIO label; we stitch runs of the same entity type together.
//
// Robust to malformed sequences a small model will occasionally emit: an I-X
// with no preceding B-X opens a new span (treated as B-X), and an I-Y directly
// after B-X (type switch mid-entity) closes the first and opens the second.

export interface TokenTag {
	start: number; // inclusive char offset into the note
	end: number; // exclusive char offset
	label: BioLabel;
}

function parse(label: BioLabel): { prefix: "B" | "I"; type: EntityType } | null {
	if (label === "O") return null;
	const [prefix, type] = label.split("-", 2) as ["B" | "I", EntityType];
	return { prefix, type };
}

export function decodeBio(note: string, tokens: TokenTag[]): EntitySpan[] {
	const spans: EntitySpan[] = [];
	let cur: { start: number; end: number; type: EntityType } | null = null;

	const flush = () => {
		if (cur) {
			spans.push({ start: cur.start, end: cur.end, type: cur.type, text: note.slice(cur.start, cur.end) });
			cur = null;
		}
	};

	for (const tok of tokens) {
		const parsed = parse(tok.label);
		if (!parsed) {
			flush();
			continue;
		}
		if (cur && parsed.prefix === "I" && parsed.type === cur.type) {
			cur.end = tok.end; // extend the current entity
		} else {
			flush(); // B-*, or a type switch, or stray I-* → start fresh
			cur = { start: tok.start, end: tok.end, type: parsed.type };
		}
	}
	flush();
	return spans;
}
