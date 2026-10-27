import { readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { $ } from "bun";

const OUTDIR = "dist";
const ENTRIES: Record<string, string> = {
	"@lukeed/html": "src/index.ts",
	"@lukeed/html/mutable": "src/mutable/index.ts",
};
const START = "<!-- size:start -->";
const END = "<!-- size:end -->";

/**
 * Minified and gzipped size of one entry, bundled alone.
 */
async function measure(
	entry: string,
	packages: "external" | "bundle",
): Promise<number> {
	let result = await Bun.build({
		entrypoints: [entry],
		target: "node",
		minify: true,
		packages,
	});
	if (!result.success)
		throw new AggregateError(result.logs, `Failed to bundle ${entry}`);
	return gzipSync(await result.outputs[0].text()).length;
}

function kb(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)} kB`;
}

await rm(OUTDIR, { recursive: true, force: true });

let result = await Bun.build({
	entrypoints: Object.values(ENTRIES),
	root: "src",
	outdir: OUTDIR,
	target: "node",
	packages: "external",
	splitting: true,
	minify: true,
});

if (!result.success) {
	for (let log of result.logs) console.error(log);
	process.exit(1);
}

for (let output of result.outputs) {
	let size = (output.size / 1024).toFixed(2).padStart(6);
	console.log(`${size} kB  ${output.path.slice(process.cwd().length + 1)}`);
}

await $`bun x tsc -p tsconfig.build.json`;

let cells = [["Module", "Size", "With dependencies"]];
for (let [name, entry] of Object.entries(ENTRIES)) {
	cells.push([
		`\`${name}\``,
		kb(await measure(entry, "external")),
		kb(await measure(entry, "bundle")),
	]);
}

let widths = cells[0].map((_, i) =>
	Math.max(...cells.map((row) => row[i].length)),
);
let line = (row: string[]) =>
	`| ${row.map((x, i) => x.padEnd(widths[i])).join(" | ")} |`;
let table = [
	line(cells[0]),
	line(widths.map((w) => "-".repeat(w))),
	...cells.slice(1).map(line),
].join("\n");

console.log(`\nMinified and gzipped:\n${table}`);

if (process.argv.includes("--readme")) {
	let readme = await readFile("readme.md", "utf8");
	let a = readme.indexOf(START);
	let b = readme.indexOf(END);
	if (a === -1 || b === -1)
		throw new Error(`readme.md needs ${START} and ${END} markers`);
	let section = `${START}\n\n${table}\n\n`;
	await writeFile("readme.md", readme.slice(0, a) + section + readme.slice(b));
}
