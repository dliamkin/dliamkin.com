// Scenario management for the Tail Risk Lab: the three presets plus named
// custom scenarios persisted to localStorage (max 10, oldest evicted).

import { ref } from "vue";
import { cloneScenario, TAIL_RISK_PRESETS } from "@/lib/tail-risk/presets";
import { MAX_STEPS, type Scenario } from "@/lib/tail-risk/types";

const STORAGE_KEY = "tail-risk-lab:scenarios";
const MAX_SAVED = 10;

function isScenario(value: unknown): value is Scenario {
	if (typeof value !== "object" || value === null) return false;
	const s = value as Partial<Scenario>;
	return (
		typeof s.id === "string" &&
		typeof s.name === "string" &&
		Array.isArray(s.steps) &&
		s.steps.length >= 1 &&
		s.steps.length <= MAX_STEPS &&
		(s.targetModel === "opus" || s.targetModel === "sonnet" || s.targetModel === "haiku")
	);
}

function readSaved(): Scenario[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isScenario).slice(0, MAX_SAVED);
	} catch {
		return [];
	}
}

export function useTailRiskScenarios() {
	const presets = TAIL_RISK_PRESETS;
	const saved = ref<Scenario[]>(readSaved());

	function persist(): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.value));
		} catch {
			// Quota exceeded / privacy mode - saving is a convenience, not a requirement.
		}
	}

	function findById(id: string): Scenario | undefined {
		return presets.find((s) => s.id === id) ?? saved.value.find((s) => s.id === id);
	}

	/** Save a copy of the scenario under a new name; evicts the oldest past 10. */
	function saveScenario(name: string, scenario: Scenario): Scenario {
		const copy = cloneScenario(scenario);
		copy.id = `saved-${Date.now().toString(36)}`;
		copy.name = name.trim() || "Untitled scenario";
		saved.value = [copy, ...saved.value].slice(0, MAX_SAVED);
		persist();
		return copy;
	}

	function deleteScenario(id: string): void {
		saved.value = saved.value.filter((s) => s.id !== id);
		persist();
	}

	return { presets, saved, findById, saveScenario, deleteScenario };
}
