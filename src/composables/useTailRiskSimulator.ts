// Orchestrates the Monte Carlo worker for the Tail Risk Lab: debounces knob
// input (~80ms), tags every request with an id and ignores late responses,
// and holds the pinned-baseline summary for the ghost overlay.

import { onBeforeUnmount, ref, shallowRef } from "vue";
import { runSimulation } from "@/lib/tail-risk/monteCarlo";
import type {
	SimulateWorkerRequest,
	SimulateWorkerResponse,
} from "@/lib/tail-risk/monteCarlo.worker";
import {
	TAIL_RISK_PRICING,
	type Policy,
	type Scenario,
	type SimulationSummary,
} from "@/lib/tail-risk/types";

const DEBOUNCE_MS = 80;

export function useTailRiskSimulator() {
	const summary = shallowRef<SimulationSummary | null>(null);
	const baseline = shallowRef<SimulationSummary | null>(null);
	const simulating = ref(false);

	let worker: Worker | null = null;
	let workerFailed = false;
	let requestId = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	function ensureWorker(): Worker | null {
		if (worker || workerFailed) return worker;
		try {
			worker = new Worker(new URL("../lib/tail-risk/monteCarlo.worker.ts", import.meta.url), {
				type: "module",
			});
			worker.onmessage = (event: MessageEvent<SimulateWorkerResponse>) => {
				// A newer request is already in flight - this result is stale.
				if (event.data.requestId !== requestId) return;
				summary.value = event.data.summary;
				simulating.value = false;
			};
			worker.onerror = () => {
				// Fall back to main-thread simulation for the session.
				worker?.terminate();
				worker = null;
				workerFailed = true;
				simulating.value = false;
			};
		} catch {
			workerFailed = true;
		}
		return worker;
	}

	function runNow(scenario: Scenario, policy: Policy): void {
		requestId++;
		const w = ensureWorker();
		if (w) {
			simulating.value = true;
			// JSON round-trip strips Vue reactivity proxies - structured clone
			// rejects them. The payload is tiny; this is not a hot path.
			const request: SimulateWorkerRequest = JSON.parse(
				JSON.stringify({ requestId, scenario, policy }),
			);
			w.postMessage(request);
		} else {
			summary.value = runSimulation(
				JSON.parse(JSON.stringify(scenario)),
				JSON.parse(JSON.stringify(policy)),
				TAIL_RISK_PRICING,
			);
		}
	}

	/** Debounced entry point - safe to call on every knob twitch. */
	function simulate(scenario: Scenario, policy: Policy): void {
		if (debounceTimer !== null) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			runNow(scenario, policy);
		}, DEBOUNCE_MS);
	}

	/** Un-debounced - for the initial render. */
	function simulateImmediate(scenario: Scenario, policy: Policy): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		runNow(scenario, policy);
	}

	function pinBaseline(): void {
		baseline.value = summary.value;
	}

	function clearBaseline(): void {
		baseline.value = null;
	}

	onBeforeUnmount(() => {
		if (debounceTimer !== null) clearTimeout(debounceTimer);
		worker?.terminate();
		worker = null;
	});

	return {
		summary,
		baseline,
		simulating,
		simulate,
		simulateImmediate,
		pinBaseline,
		clearBaseline,
	};
}
