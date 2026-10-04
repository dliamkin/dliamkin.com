import { describe, expect, it } from "vitest";
import {
	buildIcs,
	buildRrule,
	escapeText,
	foldLine,
	googleCalendarUrl,
	stableUid,
	type IcsEvent,
} from "../ics";

const encoder = new TextEncoder();

function makeEvent(partial: Partial<IcsEvent> = {}): IcsEvent {
	return {
		id: "lease-nonrenewal-notice",
		uidSeed: "written notice at least sixty (60) days prior",
		summary: "Lease non-renewal notice deadline",
		description: "Last day to deliver written notice.",
		date: "2027-07-02",
		rrule: null,
		reminderDaysBefore: 14,
		...partial,
	};
}

describe("escapeText", () => {
	it("escapes the RFC 5545 TEXT specials", () => {
		expect(escapeText("a;b,c\\d")).toBe("a\\;b\\,c\\\\d");
		expect(escapeText("line one\nline two")).toBe("line one\\nline two");
		expect(escapeText("crlf\r\ntoo")).toBe("crlf\\ntoo");
	});
});

describe("foldLine", () => {
	it("leaves short lines alone", () => {
		expect(foldLine("SUMMARY:Rent due")).toBe("SUMMARY:Rent due");
	});

	it("folds long lines to 75 octets with a space continuation", () => {
		const folded = foldLine(`DESCRIPTION:${"x".repeat(200)}`);
		const parts = folded.split("\r\n");
		expect(parts.length).toBeGreaterThan(1);
		for (const part of parts) {
			expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
		}
		for (const part of parts.slice(1)) {
			expect(part.startsWith(" ")).toBe(true);
		}
		// Unfolding (strip CRLF + one space) restores the original exactly.
		expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
	});

	it("never splits a multibyte character across the fold", () => {
		const folded = foldLine(`DESCRIPTION:${"é☂".repeat(60)}`);
		for (const part of folded.split("\r\n")) {
			expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
		}
		expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"é☂".repeat(60)}`);
	});
});

describe("buildRrule", () => {
	it("renders monthly with a day-of-month", () => {
		expect(
			buildRrule({ frequency: "monthly", day_of_month: 1, description: "monthly on the 1st" }),
		).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
	});

	it("renders weekly and yearly", () => {
		expect(buildRrule({ frequency: "weekly", day_of_month: null, description: "weekly" })).toBe(
			"FREQ=WEEKLY",
		);
		expect(buildRrule({ frequency: "yearly", day_of_month: null, description: "yearly" })).toBe(
			"FREQ=YEARLY",
		);
	});
});

describe("stableUid", () => {
	it("is stable for the same event and distinct across documents", () => {
		expect(stableUid("rent-due", "Rent is due on the 1st")).toBe(
			stableUid("rent-due", "Rent is due on the 1st"),
		);
		expect(stableUid("rent-due", "Rent is due on the 1st")).not.toBe(
			stableUid("rent-due", "Rent of $2,100 is due monthly"),
		);
	});
});

describe("buildIcs", () => {
	const now = new Date("2026-07-04T12:00:00Z");

	it("produces a well-formed all-day event with an alarm", () => {
		const ics = buildIcs([makeEvent()], { calendarName: "Paperwork", now });
		expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0");
		expect(ics).toContain("DTSTART;VALUE=DATE:20270702");
		expect(ics).toContain("DTEND;VALUE=DATE:20270703"); // exclusive end
		expect(ics).toContain("DTSTAMP:20260704T120000Z");
		expect(ics).toContain("TRIGGER:-P14D");
		expect(ics).toContain("ACTION:DISPLAY");
		expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
		// Every line is CRLF-terminated - no bare \n anywhere.
		expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
	});

	it("emits RRULE for recurring events and omits VALARM when no reminder", () => {
		const ics = buildIcs(
			[
				makeEvent({
					id: "rent-due",
					rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
					date: "2026-08-01",
					reminderDaysBefore: null,
				}),
			],
			{ calendarName: "Paperwork", now },
		);
		expect(ics).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=1");
		expect(ics).not.toContain("BEGIN:VALARM");
	});

	it("escapes event text", () => {
		const ics = buildIcs(
			[makeEvent({ summary: "Pay rent; late fee applies, always" })],
			{ calendarName: "Paperwork", now },
		);
		expect(ics).toContain("SUMMARY:Pay rent\\; late fee applies\\, always");
	});

	it("keeps UIDs stable across re-exports at different times", () => {
		const first = buildIcs([makeEvent()], { calendarName: "Paperwork", now });
		const second = buildIcs([makeEvent({ summary: "Edited title" })], {
			calendarName: "Paperwork",
			now: new Date("2026-07-05T09:00:00Z"),
		});
		const uid = (ics: string) => ics.match(/UID:(\S+)/)?.[1];
		expect(uid(first)).toBeDefined();
		expect(uid(first)).toBe(uid(second));
	});

	it("folds long description lines to the 75-octet limit", () => {
		const ics = buildIcs(
			[makeEvent({ description: "An obligation. ".repeat(30) })],
			{ calendarName: "Paperwork", now },
		);
		for (const line of ics.split("\r\n")) {
			expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
		}
	});
});

describe("googleCalendarUrl", () => {
	it("builds a prefilled all-day template link", () => {
		const url = new URL(googleCalendarUrl(makeEvent()));
		expect(url.hostname).toBe("calendar.google.com");
		expect(url.searchParams.get("action")).toBe("TEMPLATE");
		expect(url.searchParams.get("dates")).toBe("20270702/20270703");
		expect(url.searchParams.get("text")).toBe("Lease non-renewal notice deadline");
	});

	it("includes recurrence when present", () => {
		const url = new URL(
			googleCalendarUrl(makeEvent({ rrule: "FREQ=MONTHLY;BYMONTHDAY=1" })),
		);
		expect(url.searchParams.get("recur")).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=1");
	});
});
