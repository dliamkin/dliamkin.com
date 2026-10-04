import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config";

// The data-generation scripts use the developer's local API key - the same one
// the Cloudflare Worker reads from .dev.vars in dev. tsx does not auto-load
// dotenv files, so this reads ANTHROPIC_API_KEY from the process env first and
// falls back to .dev.vars / .env.local as a convenience. It never prints the
// value and never writes it anywhere. In CI this path is unused - the student
// eval suite runs the model in-process with zero API spend.
export function loadApiKey(): string {
	if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

	for (const file of [".dev.vars", ".env.local", ".env"]) {
		const full = path.join(REPO_ROOT, file);
		if (!fs.existsSync(full)) continue;
		for (const line of fs.readFileSync(full, "utf8").split("\n")) {
			const match = /^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
			if (match?.[1]) {
				const value = match[1].replace(/^["']|["']$/g, "");
				process.env.ANTHROPIC_API_KEY = value;
				return value;
			}
		}
	}

	throw new Error(
		"ANTHROPIC_API_KEY not found in env or .dev.vars/.env.local. " +
			"Export it or add it to .dev.vars before a real (non --mock) run.",
	);
}
