import { diffArrays } from "diff";

// Pre-computes a compact, mechanical changed-blocks summary of two lease
// texts before the model call (worker/index.ts and
// scripts/generate-lease-samples.mjs). This grounds the model - the diff acts
// as a checklist so no change is missed - while the model handles the
// semantic explanation. Never imported by client code; the `diff` package
// stays out of the browser bundle.

export interface ChangedBlock {
	kind: "added" | "removed" | "modified";
	original: string | null; // null when kind is "added"
	revised: string | null; // null when kind is "removed"
}

// Collapse runs of whitespace so reflowed paragraphs (e.g. PDF extraction)
// don't register as changes.
function normalizeBlock(block: string): string {
	return block.replace(/\s+/g, " ").trim();
}

// Leases split naturally on blank lines and numbered clauses; either boundary
// starts a new block.
export function splitIntoBlocks(text: string): string[] {
	return text
		.split(/\n\s*\n|\n(?=\s*\d+[.)]\s)/)
		.map(normalizeBlock)
		.filter((block) => block.length > 0);
}

export function computeChangedBlocks(originalText: string, revisedText: string): ChangedBlock[] {
	const parts = diffArrays(splitIntoBlocks(originalText), splitIntoBlocks(revisedText));

	const blocks: ChangedBlock[] = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part) continue;
		if (part.removed) {
			const next = parts[i + 1];
			// A removed run followed by an added run is a modification - pair
			// them up so the model sees before/after together.
			if (next?.added) {
				const max = Math.max(part.value.length, next.value.length);
				for (let j = 0; j < max; j++) {
					blocks.push({
						kind: "modified",
						original: part.value[j] ?? null,
						revised: next.value[j] ?? null,
					});
				}
				i++;
				continue;
			}
			for (const value of part.value) {
				blocks.push({ kind: "removed", original: value, revised: null });
			}
		} else if (part.added) {
			for (const value of part.value) {
				blocks.push({ kind: "added", original: null, revised: value });
			}
		}
	}
	return blocks;
}

// Rendered into the model's user message alongside both full texts.
export function formatChangedBlocks(blocks: ChangedBlock[]): string {
	if (blocks.length === 0) {
		return "No changed blocks detected by the mechanical diff.";
	}
	return blocks
		.map((block, i) => {
			const lines = [`[${i + 1}] ${block.kind.toUpperCase()}`];
			if (block.original !== null) lines.push(`  original: ${block.original}`);
			if (block.revised !== null) lines.push(`  revised: ${block.revised}`);
			return lines.join("\n");
		})
		.join("\n");
}
