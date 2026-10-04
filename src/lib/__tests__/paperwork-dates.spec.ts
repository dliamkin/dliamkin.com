import { describe, expect, it } from "vitest";
import {
	addDays,
	addMonths,
	describeResolution,
	isIsoDate,
	isPast,
	reconcileComputedDates,
	resolveDate,
	todayUtcIso,
} from "../paperwork-dates";
import type { DateResolution, ObligationEvent, ObligationExtraction } from "../paperwork";

// The resolve-flow's arithmetic runs here, not in the model - so these tests
// are the actual guarantee behind "computed (from your input)" dates. Month
// boundaries, year boundaries, and leap years are the cases that bite.

describe("isIsoDate", () => {
	it("accepts real dates", () => {
		expect(isIsoDate("2026-07-04")).toBe(true);
		expect(isIsoDate("2028-02-29")).toBe(true); // leap year
	});

	it("rejects impossible dates instead of rolling them over", () => {
		expect(isIsoDate("2026-02-30")).toBe(false);
		expect(isIsoDate("2027-02-29")).toBe(false); // not a leap year
		expect(isIsoDate("2026-13-01")).toBe(false);
	});

	it("rejects non-ISO shapes", () => {
		expect(isIsoDate("07/04/2026")).toBe(false);
		expect(isIsoDate("2026-7-4")).toBe(false);
		expect(isIsoDate("")).toBe(false);
	});
});

describe("addDays", () => {
	it("crosses month boundaries", () => {
		// The lease sample's headline computation: 60-day notice before Aug 31.
		expect(addDays("2027-08-31", -60)).toBe("2027-07-02");
		expect(addDays("2026-06-28", 5)).toBe("2026-07-03");
	});

	it("crosses year boundaries", () => {
		expect(addDays("2027-01-14", -30)).toBe("2026-12-15");
		expect(addDays("2026-12-20", 15)).toBe("2027-01-04");
	});

	it("handles leap years", () => {
		expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
		expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
		expect(addDays("2028-01-31", 30)).toBe("2028-03-01"); // leap February
		expect(addDays("2026-01-31", 30)).toBe("2026-03-02"); // non-leap
	});

	it("throws on invalid input rather than guessing", () => {
		expect(() => addDays("2026-02-30", 1)).toThrow("Not a valid ISO date");
	});
});

describe("addMonths", () => {
	it("adds plain months", () => {
		expect(addMonths("2026-03-15", 6)).toBe("2026-09-15");
		expect(addMonths("2026-10-01", 4)).toBe("2027-02-01");
	});

	it("clamps to the target month's last day", () => {
		expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
		expect(addMonths("2028-01-31", 1)).toBe("2028-02-29"); // leap year
		expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
		expect(addMonths("2026-05-31", 1)).toBe("2026-06-30");
	});

	it("subtracts months with the same clamping", () => {
		expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
		expect(addMonths("2027-01-15", -2)).toBe("2026-11-15");
	});
});

describe("resolveDate", () => {
	const need = (partial: Partial<DateResolution>): DateResolution => ({
		anchor_label: "anchor",
		anchor_date: null,
		offset_days: 0,
		offset_months: 0,
		direction: "after",
		...partial,
	});

	it("applies day offsets in both directions", () => {
		expect(resolveDate("2026-08-31", need({ offset_days: 60, direction: "before" }))).toBe(
			"2026-07-02",
		);
		expect(resolveDate("2026-07-01", need({ offset_days: 30, direction: "after" }))).toBe(
			"2026-07-31",
		);
	});

	it("applies month offsets", () => {
		// The lease sample's unresolvable item: 30 days after an anniversary.
		expect(resolveDate("2026-03-01", need({ offset_months: 6 }))).toBe("2026-09-01");
		expect(
			resolveDate("2026-08-31", need({ offset_months: 6, direction: "before" })),
		).toBe("2026-02-28");
	});

	it("applies months before days", () => {
		// 1 month + 15 days after Jan 31: clamp to Feb 28, then +15 = Mar 15.
		expect(
			resolveDate("2026-01-31", need({ offset_months: 1, offset_days: 15 })),
		).toBe("2026-03-15");
	});
});

describe("isPast", () => {
	it("compares against the reference day", () => {
		expect(isPast("2026-06-30", "2026-07-01")).toBe(true);
		expect(isPast("2026-07-01", "2026-07-01")).toBe(false); // today is not past
		expect(isPast("2026-07-02", "2026-07-01")).toBe(false);
	});

	it("is false for invalid input", () => {
		expect(isPast("not-a-date", "2026-07-01")).toBe(false);
	});
});

describe("todayUtcIso", () => {
	it("formats the UTC date", () => {
		expect(todayUtcIso(new Date("2026-07-04T23:59:00Z"))).toBe("2026-07-04");
	});
});

describe("reconcileComputedDates", () => {
	const TODAY = "2026-07-01";

	function makeEvent(partial: Partial<ObligationEvent>): ObligationEvent {
		return {
			id: "test-event",
			title: "Test event",
			category: "deadline",
			date: null,
			date_basis: "unresolved",
			computation: null,
			resolution: null,
			recurrence: null,
			in_past: false,
			source_excerpt: "excerpt",
			details: "details",
			suggested_reminder_days: 7,
			stakes: "medium",
			...partial,
		};
	}

	function makeExtraction(events: ObligationEvent[]): ObligationExtraction {
		return {
			is_obligation_document: true,
			reason: null,
			document_label: "Test document",
			anchor_dates: [],
			events,
			ambiguities: [],
		};
	}

	it("overrides a model arithmetic slip (the leap-year miss seen in CI)", () => {
		const result = reconcileComputedDates(
			makeExtraction([
				makeEvent({
					date: "2028-03-02", // model treated Feb 2028 as 28 days
					date_basis: "computed",
					computation: "2028-01-31 plus 30 days = 2028-03-02",
					resolution: {
						anchor_label: "invoice date",
						anchor_date: "2028-01-31",
						offset_days: 30,
						offset_months: 0,
						direction: "after",
					},
				}),
			]),
			TODAY,
		);
		expect(result.events[0]?.date).toBe("2028-03-01");
		expect(result.events[0]?.computation).toBe(
			"2028-01-31 (invoice date) plus 30 days = 2028-03-01",
		);
	});

	it("recomputes in_past when the corrected date crosses today", () => {
		const result = reconcileComputedDates(
			makeExtraction([
				makeEvent({
					date: "2026-07-05", // wrong: correct date is in the past
					date_basis: "computed",
					in_past: false,
					resolution: {
						anchor_label: "notice date",
						anchor_date: "2026-06-01",
						offset_days: 20,
						offset_months: 0,
						direction: "after",
					},
				}),
			]),
			TODAY,
		);
		expect(result.events[0]?.date).toBe("2026-06-21");
		expect(result.events[0]?.in_past).toBe(true);
	});

	it("leaves correct computed dates untouched, including their computation text", () => {
		const event = makeEvent({
			date: "2027-07-02",
			date_basis: "computed",
			computation: "2027-08-31 minus 60 days = 2027-07-02",
			resolution: {
				anchor_label: "lease end date",
				anchor_date: "2027-08-31",
				offset_days: 60,
				offset_months: 0,
				direction: "before",
			},
		});
		const result = reconcileComputedDates(makeExtraction([event]), TODAY);
		expect(result.events[0]).toBe(event);
	});

	it("never fills in unresolved dates", () => {
		const result = reconcileComputedDates(
			makeExtraction([
				makeEvent({
					date: null,
					date_basis: "unresolved",
					resolution: {
						anchor_label: "hire date",
						anchor_date: null,
						offset_days: 60,
						offset_months: 0,
						direction: "after",
					},
				}),
			]),
			TODAY,
		);
		expect(result.events[0]?.date).toBeNull();
		expect(result.events[0]?.date_basis).toBe("unresolved");
	});

	it("skips computed dates without a usable anchor (pattern-derived or malformed)", () => {
		const noResolution = makeEvent({ date: "2026-08-01", date_basis: "computed" });
		const badAnchor = makeEvent({
			date: "2026-08-01",
			date_basis: "computed",
			resolution: {
				anchor_label: "start",
				anchor_date: "not-a-date",
				offset_days: 5,
				offset_months: 0,
				direction: "after",
			},
		});
		const result = reconcileComputedDates(makeExtraction([noResolution, badAnchor]), TODAY);
		expect(result.events[0]?.date).toBe("2026-08-01");
		expect(result.events[1]?.date).toBe("2026-08-01");
	});
});

describe("describeResolution", () => {
	it("shows the arithmetic it performed", () => {
		expect(
			describeResolution("2026-08-31", {
				anchor_label: "lease end date",
				anchor_date: null,
				offset_days: 60,
				offset_months: 0,
				direction: "before",
			}),
		).toBe("2026-08-31 minus 60 days = 2026-07-02");
		expect(
			describeResolution("2026-03-01", {
				anchor_label: "policy start date",
				anchor_date: null,
				offset_days: 0,
				offset_months: 6,
				direction: "after",
			}),
		).toBe("2026-03-01 plus 6 months = 2026-09-01");
	});
});
