import { spawnSync } from "node:child_process";

import type { Candidate, Input } from "./suite";

export type Retained = {
	/** Median retained bytes. */
	bytes: number;
	/** Largest relative distance of any sample from the median. */
	spread: number;
};

/** The flag that makes the runner measure one sample and exit. */
export const FLAG = "--memory";

const SAMPLES = 5;
const SINK: { value: unknown } = { value: undefined };

function collect(): void {
	if (!globalThis.gc)
		throw new Error("Run Node with --expose-gc to measure memory");
	globalThis.gc();
	globalThis.gc();
}

function heap(): number {
	let usage = process.memoryUsage();
	return usage.heapUsed + usage.external;
}

/**
 * Measure one sample: bytes still reachable after running `candidate` once
 * and keeping its result. Call it once per process; later calls in the same
 * process can read as zero.
 */
export function sample(candidate: Candidate, inputs: Input[]): number {
	collect();
	let before = heap();
	SINK.value = candidate.run(inputs);
	collect();
	return heap() - before;
}

/**
 * Measure `candidate` in fresh Node processes and return the median.
 * @param script The bundled runner, which handles {@link FLAG}.
 */
export function retained(
	script: string,
	suite: string,
	candidate: string,
): Retained {
	let sizes: number[] = [];

	for (let i = 0; i < SAMPLES; i++) {
		let child = spawnSync(
			process.execPath,
			["--expose-gc", script, FLAG, suite, candidate],
			{
				encoding: "utf8",
			},
		);
		let bytes = Number(child.stdout.trim());
		if (child.status !== 0 || !Number.isFinite(bytes)) {
			throw new Error(
				`Memory sample failed for ${suite} :: ${candidate}\n${child.stderr}`,
			);
		}
		sizes.push(bytes);
	}

	sizes.sort((a, b) => a - b);
	let bytes = sizes[sizes.length >> 1];
	let spread =
		Math.max(...sizes.map((x) => Math.abs(x - bytes))) / Math.max(bytes, 1);
	return { bytes, spread };
}
