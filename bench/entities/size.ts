import { gzipSync } from "node:zlib";
import { join } from "node:path";

let entry = join(import.meta.dirname, ".entry.ts");

for (let [label, code] of [
	[
		"entities (decode + escape)",
		`export { decodeHTML, decodeHTMLAttribute } from "entities/decode"; export { escapeText, escapeAttribute } from "entities/escape";`,
	],
	["prototype (decode)", `export { decode } from "./decode";`],
] as const) {
	await Bun.write(entry, code);
	let result = await Bun.build({
		entrypoints: [entry],
		minify: true,
		target: "node",
	});
	let out = await result.outputs[0].text();
	console.log(
		label.padEnd(28),
		"min",
		(out.length / 1024).toFixed(1),
		"kB  gzip",
		(gzipSync(out).length / 1024).toFixed(1),
		"kB",
	);
}
