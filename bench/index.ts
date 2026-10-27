import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { bench, do_not_optimize, group, run, summary } from "mitata";

import * as corpus from "./corpus";
import * as edit from "./edit";
import * as memory from "./memory";
import * as parse from "./parse";
import * as query from "./query";

import type { Retained } from "./memory";
import type { Input, Suite } from "./suite";

export type Row = {
	name: string;
	/** Average milliseconds for all pages. */
	avg: number;
	p75: number;
	p99: number;
	/** Retained memory, when measured. */
	memory: Retained | undefined;
};

export type Result = {
	runtime: string;
	cpu: string;
	date: string;
	pages: number;
	bytes: number;
	suites: { id: string; rows: Row[] }[];
};

const SUITES: Suite[] = [parse.parse, query.query, edit.roundtrip, edit.edit];

/** Suites whose results are kept trees, so retained memory is meaningful. */
const MEMORY = new Set(["parse"]);

const pages = await corpus.load();
const inputs: Input[] = pages.map((x) => ({
	html: x.html,
	bytes: new TextEncoder().encode(x.html),
}));

if (process.argv[2] === memory.FLAG) {
	let [suite, name] = process.argv.slice(3);
	let candidate = SUITES.find((x) => x.id === suite)?.candidates.find(
		(x) => x.name === name,
	);
	if (!candidate) throw new Error(`Unknown candidate: ${suite} :: ${name}`);
	console.log(memory.sample(candidate, inputs));
	process.exit(0);
}

const size = pages.reduce((sum, x) => sum + x.html.length, 0);
const runtime = globalThis.Bun
	? `Bun ${Bun.version}`
	: `Node ${process.version}`;

console.log(
	`${runtime}, ${pages.length} pages, ${(size / 1e6).toFixed(2)} MB\n`,
);

for (let suite of SUITES) {
	summary(() => {
		group(suite.title, () => {
			for (let candidate of suite.candidates) {
				bench(candidate.name, () => {
					do_not_optimize(candidate.run(inputs));
				}).gc("inner");
			}
		});
	});
}

let output = await run({ colors: false });
let measured = !globalThis.Bun;
let trials = output.benchmarks.values();

let result: Result = {
	runtime,
	cpu: output.context.cpu.name ?? "unknown",
	date: new Date().toISOString().slice(0, 10),
	pages: pages.length,
	bytes: size,
	suites: SUITES.map((suite) => ({
		id: suite.id,
		rows: suite.candidates.map((candidate) => {
			let trial = trials.next().value;
			let stats = trial?.runs[0]?.stats;
			if (!stats || trial?.alias !== candidate.name) {
				throw new Error(`Missing result for ${suite.id} :: ${candidate.name}`);
			}
			return {
				name: candidate.name,
				avg: stats.avg / 1e6,
				p75: stats.p75 / 1e6,
				p99: stats.p99 / 1e6,
				memory:
					measured && MEMORY.has(suite.id)
						? memory.retained(process.argv[1], suite.id, candidate.name)
						: undefined,
			};
		}),
	})),
};

let dir = join(import.meta.dirname, "results");
await mkdir(dir, { recursive: true });
await writeFile(
	join(dir, globalThis.Bun ? "bun.json" : "node.json"),
	JSON.stringify(result, null, 2) + "\n",
);
