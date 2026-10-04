import type { DateResolution, ObligationExtraction } from "./paperwork";

// Pure ISO-date (YYYY-MM-DD) arithmetic for the Paperwork → Calendar demo.
// This is the deterministic half of the date-integrity design: the model only
// identifies what math is needed (paperwork.ts DateResolution); the actual
// resolution runs here, in tested code. Everything works on calendar dates as
// UTC to sidestep local-timezone hazards - obligations are date-scoped, never
// time-scoped.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
	if (!ISO_DATE_RE.test(value)) return false;
	// Round-trip through Date.UTC to reject impossible dates like 2026-02-30,
	// which Date would otherwise silently roll into March.
	const [y, m, d] = value.split("-").map(Number) as [number, number, number];
	const date = new Date(Date.UTC(y, m - 1, d));
	return (
		date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
	);
}

function toUtc(iso: string): Date {
	if (!isIsoDate(iso)) throw new Error(`Not a valid ISO date: ${iso}`);
	const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
	const date = toUtc(iso);
	date.setUTCDate(date.getUTCDate() + days);
	return toIso(date);
}

// Month arithmetic clamps to the target month's last day (Jan 31 + 1 month =
// Feb 28/29), matching how contract language like "six months after the start
// date" is conventionally read - it never spills into the following month.
export function addMonths(iso: string, months: number): string {
	const date = toUtc(iso);
	const day = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() + months);
	const lastDay = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
	).getUTCDate();
	date.setUTCDate(Math.min(day, lastDay));
	return toIso(date);
}

// Applies a model-identified offset to a user-supplied anchor date. Months
// first, then days - "6 months and 10 days after" reads as month arithmetic
// refined by days, and the two operations only interact at month-end clamps.
export function resolveDate(anchorIso: string, resolution: DateResolution): string {
	const sign = resolution.direction === "before" ? -1 : 1;
	const afterMonths = addMonths(anchorIso, sign * resolution.offset_months);
	return addDays(afterMonths, sign * resolution.offset_days);
}

// Lexicographic comparison is chronological for zero-padded ISO dates.
export function isPast(iso: string, todayIso: string): boolean {
	if (!isIsoDate(iso) || !isIsoDate(todayIso)) return false;
	return iso < todayIso;
}

export function todayUtcIso(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

// Exported for the review UI's human phrasing ("we'll count 30 days after…").
export function formatOffset(resolution: DateResolution): string {
	const parts: string[] = [];
	if (resolution.offset_months > 0) {
		parts.push(`${resolution.offset_months} month${resolution.offset_months === 1 ? "" : "s"}`);
	}
	if (resolution.offset_days > 0) {
		parts.push(`${resolution.offset_days} day${resolution.offset_days === 1 ? "" : "s"}`);
	}
	return parts.length > 0 ? parts.join(" and ") : "0 days";
}

// Human-readable rendering for the review UI, e.g. "2026-03-01 plus 6 months
// = 2026-09-01". Kept here so the arithmetic and its explanation can't drift.
export function describeResolution(anchorIso: string, resolution: DateResolution): string {
	const op = resolution.direction === "before" ? "minus" : "plus";
	return `${anchorIso} ${op} ${formatOffset(resolution)} = ${resolveDate(anchorIso, resolution)}`;
}

// The date-integrity backstop for computed dates: the model reports the
// anchor date and offset it found (its language strength), and the actual
// arithmetic runs here, overriding the model's own - LLM day-counting is
// unreliable around month lengths and leap years (observed: Sonnet computed
// "2028-01-31 plus 30 days" as 2028-03-02 in CI). Only events the model
// already marked computed with a stated anchor are touched: unresolved dates
// are never filled in, and stated dates are transcription, not arithmetic.
export function reconcileComputedDates(
	extraction: ObligationExtraction,
	todayIso: string,
): ObligationExtraction {
	return {
		...extraction,
		events: extraction.events.map((event) => {
			const res = event.resolution;
			if (
				event.date_basis !== "computed" ||
				res === null ||
				res.anchor_date === null ||
				!isIsoDate(res.anchor_date)
			) {
				return event;
			}
			const correct = resolveDate(res.anchor_date, res);
			if (event.date === correct) return event;
			const op = res.direction === "before" ? "minus" : "plus";
			return {
				...event,
				date: correct,
				in_past: isPast(correct, todayIso),
				computation: `${res.anchor_date} (${res.anchor_label}) ${op} ${formatOffset(res)} = ${correct}`,
			};
		}),
	};
}
