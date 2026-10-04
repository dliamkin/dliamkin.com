import { diffArrays } from "diff";

// Paragraph-level mechanical diff for the ToS watchdog pipeline
// (src/lib/pipelines/explain-tos-change.ts). Unlike the lease pipeline -
// which sends both full documents plus the diff - this project sends the
// model ONLY these changed blocks with surrounding context: ToS documents
// run tens of thousands of words, and on a nightly monitor the diff blocks
// are what keep the change-day token cost sane. Never imported by client
// code; the `diff` package stays out of the browser bundle.

export interface TosChangedBlock {
	kind: "added" | "removed" | "modified";
	original: string | null; // null when kind is "added"
	revised: string | null; // null when kind is "removed"
	contextBefore: string | null; // nearest unchanged block above, if any
	contextAfter: string | null; // nearest unchanged block below, if any
}

// Normalized snapshot text is blocks joined by \n\n (scripts/tos-watch/
// normalize.ts), so the block boundary is exact, not heuristic.
export function splitIntoBlocks(text: string): string[] {
	return text
		.split(/\n\s*\n/)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);
}

export function computeTosChangedBlocks(
	previousText: string,
	currentText: string,
): TosChangedBlock[] {
	const parts = diffArrays(splitIntoBlocks(previousText), splitIntoBlocks(currentText));

	const blocks: TosChangedBlock[] = [];
	const lastUnchangedBefore = (index: number): string | null => {
		for (let i = index - 1; i >= 0; i--) {
			const part = parts[i];
			if (part && !part.added && !part.removed) return part.value[part.value.length - 1] ?? null;
		}
		return null;
	};
	const firstUnchangedAfter = (index: number): string | null => {
		for (let i = index + 1; i < parts.length; i++) {
			const part = parts[i];
			if (part && !part.added && !part.removed) return part.value[0] ?? null;
		}
		return null;
	};

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part || (!part.added && !part.removed)) continue;
		const contextBefore = lastUnchangedBefore(i);

		// A removed run followed by an added run is a modification - pair them
		// up so the model sees before/after together.
		const next = parts[i + 1];
		if (part.removed && next?.added) {
			const contextAfter = firstUnchangedAfter(i + 1);
			const max = Math.max(part.value.length, next.value.length);
			for (let j = 0; j < max; j++) {
				blocks.push({
					kind: "modified",
					original: part.value[j] ?? null,
					revised: next.value[j] ?? null,
					contextBefore,
					contextAfter,
				});
			}
			i++;
			continue;
		}

		const contextAfter = firstUnchangedAfter(i);
		for (const value of part.value) {
			blocks.push(
				part.removed
					? { kind: "removed", original: value, revised: null, contextBefore, contextAfter }
					: { kind: "added", original: null, revised: value, contextBefore, contextAfter },
			);
		}
	}
	return blocks;
}

// Rendered into the model's user message. Context blocks orient the model in
// the surrounding document without shipping the whole thing.
export function formatTosChangedBlocks(blocks: TosChangedBlock[]): string {
	if (blocks.length === 0) {
		return "No changed blocks detected by the mechanical diff.";
	}
	return blocks
		.map((block, i) => {
			const lines = [`[${i + 1}] ${block.kind.toUpperCase()}`];
			if (block.contextBefore) lines.push(`  unchanged context before: ${block.contextBefore}`);
			if (block.original !== null) lines.push(`  old text: ${block.original}`);
			if (block.revised !== null) lines.push(`  new text: ${block.revised}`);
			if (block.contextAfter) lines.push(`  unchanged context after: ${block.contextAfter}`);
			return lines.join("\n");
		})
		.join("\n");
}
