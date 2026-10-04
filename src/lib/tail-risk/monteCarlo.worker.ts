// Web Worker wrapper around the pure engine. The main thread posts
// { requestId, scenario, policy }; the worker replies with the summary and
// echoes the requestId so useTailRiskSimulator can drop stale responses when
// the user outruns the debounce.

import { runSimulation } from "./monteCarlo";
import { TAIL_RISK_PRICING, type Policy, type Scenario, type SimulationSummary } from "./types";

export interface SimulateWorkerRequest {
	requestId: number;
	scenario: Scenario;
	policy: Policy;
}

export interface SimulateWorkerResponse {
	requestId: number;
	summary: SimulationSummary;
}

// tsconfig.app targets the DOM lib, where `self` is a Window - narrow it to
// the two members a dedicated worker scope actually uses here.
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<SimulateWorkerRequest>) => void) | null;
	postMessage(message: SimulateWorkerResponse): void;
};

scope.onmessage = (event) => {
	const { requestId, scenario, policy } = event.data;
	const summary = runSimulation(scenario, policy, TAIL_RISK_PRICING);
	scope.postMessage({ requestId, summary });
};
