import { readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { $ } from "bun";

type Mode = {
	name: string;
	entry: string;
	/** Output path, relative to the package root. */
	file: string;
};

const OUTDIR = "dist";
const MODES: Mode[] = [
	{ name: "@lukeed/html", entry: "src/index.ts", file: "dist/index.js" },
	{
		name: "@lukeed/html/mutable",
		entry: "src/mutable/index.ts",
		file: "dist/mutable/index.js",
	},
];
const START = "<!-- modes:start -->";
const END = "<!-- modes:end -->";

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

function size(bytes: number): string {
	return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} kB`;
}

await rm(OUTDIR, { recursive: true, force: true });

let result = await Bun.build({
	entrypoints: MODES.map((x) => x.entry),
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
	let kb = (output.size / 1024).toFixed(2).padStart(6);
	console.log(`${kb} kB  ${output.path.slice(process.cwd().length + 1)}`);
}

await $`bun x tsc -p tsconfig.build.json`;

let blocks: string[] = [];
for (let mode of MODES) {
	let own = size(await measure(mode.entry, "external"));
	let total = size(await measure(mode.entry, "bundle"));
	blocks.push(
		[
			`#### \`${mode.name}\``,
			"",
			`> **Size (gzip):** ${own}, or ${total} with \`entities\`<br>`,
			`> **Availability:** [ES Module](https://unpkg.com/@lukeed/html/${mode.file})`,
		].join("\n"),
	);
}

let section = blocks.join("\n\n");
console.log(`\n${section}`);

if (process.argv.includes("--readme")) {
	let readme = await readFile("readme.md", "utf8");
	let a = readme.indexOf(START);
	let b = readme.indexOf(END);
	if (a === -1 || b === -1)
		throw new Error(`readme.md needs ${START} and ${END} markers`);
	await writeFile(
		"readme.md",
		readme.slice(0, a) + `${START}\n\n${section}\n\n` + readme.slice(b),
	);
}
