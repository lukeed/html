import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as corpus from "./corpus";
import * as edit from "./edit";
import * as parse from "./parse";
import * as query from "./query";

import type { Result, Row } from "./run";
import type { Suite } from "./suite";

const ROOT = join(import.meta.dirname, "..", "..");
const SUITES: Suite[] = [parse.parse, query.query, edit.roundtrip, edit.edit];
const START = "<!-- bench:start -->";
const END = "<!-- bench:end -->";
const GAP = 4;
const NONE = "–";

async function load(name: string): Promise<Result> {
	let file = join(import.meta.dirname, "..", "results", name);
	return JSON.parse(await readFile(file, "utf8"));
}

function ms(value: number | undefined): string {
	return value === undefined ? NONE : `${value.toFixed(1)}ms`;
}

function mb(value: number | undefined): string {
	return value === undefined ? NONE : `${(value / 1e6).toFixed(1)}MB`;
}

function size(bytes: number): string {
	return bytes >= 1e6
		? `${(bytes / 1e6).toFixed(2)} MB`
		: `${Math.round(bytes / 1e3)} kB`;
}

/**
 * Render rows as aligned columns under a `Benchmark :: title` header.
 * Values are right-aligned in their column; a missing value is not.
 */
function block(title: string, columns: string[], rows: string[][]): string {
	let names = rows.map((x) => x[0]);
	let first = Math.max(title.length, ...names.map((x) => x.length + 2)) + GAP;
	let widths = columns.map(
		(column, i) =>
			Math.max(column.length, ...rows.map((x) => x[i + 1].length)) + GAP,
	);
	let values = columns.map((_, i) =>
		Math.max(...rows.map((x) => (x[i + 1] === NONE ? 0 : x[i + 1].length))),
	);
	let align = (x: string, i: number) =>
		x === NONE ? x : x.padStart(values[i]);

	let line = (head: string, cells: string[]) =>
		(
			head.padEnd(first) + cells.map((x, i) => x.padEnd(widths[i])).join("")
		).trimEnd();

	return [
		line(title, columns),
		...rows.map((x) => line("  " + x[0], x.slice(1).map(align))),
	].join("\n");
}

function find(result: Result, suite: string, name: string): Row | undefined {
	return result.suites
		.find((x) => x.id === suite)
		?.rows.find((x) => x.name === name);
}

function names(bun: Result, node: Result, suite: Suite): string[] {
	let seen = new Set<string>();
	for (let result of [bun, node]) {
		for (let row of result.suites.find((x) => x.id === suite.id)?.rows ?? [])
			seen.add(row.name);
	}
	return [...seen];
}

function short(bun: Result, node: Result): string {
	return SUITES.map((suite) => {
		let memory = node.suites
			.find((x) => x.id === suite.id)
			?.rows.some((x) => x.memory !== undefined);
		let columns = memory ? ["Bun", "Node", "Memory"] : ["Bun", "Node"];
		let rows = names(bun, node, suite).map((name) => {
			let b = find(bun, suite.id, name);
			let n = find(node, suite.id, name);
			let cells = [name, ms(b?.avg), ms(n?.avg)];
			return memory ? [...cells, mb(n?.memory?.bytes)] : cells;
		});
		return block(
			`Benchmark :: ${suite.title} (${size(bun.bytes)})`,
			columns,
			rows,
		);
	}).join("\n\n");
}

function long(bun: Result, node: Result): string {
	return SUITES.map((suite) => {
		let memory = node.suites
			.find((x) => x.id === suite.id)
			?.rows.some((x) => x.memory !== undefined);
		let columns = ["Bun avg", "p75", "p99", "Node avg", "p75", "p99"];
		if (memory) columns.push("Memory");
		let rows = names(bun, node, suite).map((name) => {
			let b = find(bun, suite.id, name);
			let n = find(node, suite.id, name);
			let cells = [
				name,
				ms(b?.avg),
				ms(b?.p75),
				ms(b?.p99),
				ms(n?.avg),
				ms(n?.p75),
				ms(n?.p99),
			];
			return memory ? [...cells, mb(n?.memory?.bytes)] : cells;
		});
		let table = block(
			`Benchmark :: ${suite.title} (${size(bun.bytes)})`,
			columns,
			rows,
		);
		return `### ${suite.title}\n\n${suite.about}\n\n\`\`\`txt\n${table}\n\`\`\``;
	}).join("\n\n");
}

function spread(node: Result): string {
	let max = 0;
	for (let suite of node.suites) {
		for (let row of suite.rows) max = Math.max(max, row.memory?.spread ?? 0);
	}
	return `${(max * 100).toFixed(1)}%`;
}

function environment(bun: Result, node: Result): string {
	let when = bun.date === node.date ? bun.date : `${bun.date} and ${node.date}`;
	return `${bun.runtime} and ${node.runtime} on ${bun.cpu}, ${when}.`;
}

let bun = await load("bun.json");
let node = await load("node.json");
let pages = await corpus.load();

let readme = await readFile(join(ROOT, "readme.md"), "utf8");
let a = readme.indexOf(START);
let b = readme.indexOf(END);
if (a === -1 || b === -1)
	throw new Error(`readme.md needs ${START} and ${END} markers`);

let summary = [
	START,
	"",
	`> ${environment(bun, node)} ${bun.pages} real pages, ${size(bun.bytes)} in total. Memory is retained heap on Node. See [\`bench/readme.md\`](bench/readme.md) for details.`,
	"",
	"```txt",
	short(bun, node),
	"```",
	"",
	"",
].join("\n");

await writeFile(
	join(ROOT, "readme.md"),
	readme.slice(0, a) + summary + readme.slice(b),
);

let detail = `# Benchmarks

> This file is generated by \`bun run bench all\`. Do not edit it by hand.

${environment(bun, node)}

## Running

\`\`\`sh
$ bun run bench build    # download missing pages and bundle the Node runner
$ bun run bench all      # build, run on Bun and Node, then write this file and the readme summary
$ bun run bench compare  # check correctness against htmlparser2
\`\`\`

## Corpus

Every workload runs on all ${bun.pages} pages per iteration, ${size(bun.bytes)} in total:

${pages.map((x) => `- ${x.name} (${size(x.html.length)})`).join("\n")}

## Method

- Timing uses [mitata](https://github.com/evanwashere/mitata). Each iteration runs the workload on every page, and starts with a collected heap, so one candidate's garbage does not slow the next.
- \`avg\`, \`p75\`, and \`p99\` are per iteration, so they cover all pages.
- **Memory** is the heap that is still reachable after the workload, with its results kept, after full collections on Node. Each sample runs in a fresh process, because a second sample in the same process can read as zero. It is the median of 5 samples, which agree within ${spread(node)}. It is only shown for \`parse\`, where the result is the tree. Other workloads keep only small results or one output string.
- Memory is not shown for Bun. JavaScriptCore scans the stack conservatively, so garbage from earlier samples stays alive, and its heap counters leave out memory allocated outside the object heap. Repeated samples were not stable.
- Bun's \`HTMLRewriter\` only runs on Bun, so it has no Node results.
- \`bun run bench compare\` checks that @lukeed/html builds the same tree as htmlparser2 for every page, and that the edit workload produces valid output.

## Results

${long(bun, node)}
`;

await writeFile(join(import.meta.dirname, "..", "readme.md"), detail);
console.log(short(bun, node));
