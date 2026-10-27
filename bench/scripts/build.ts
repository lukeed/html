import { join } from "node:path";

import * as corpus from "./corpus";

const OUTFILE = join(import.meta.dirname, "..", "dist", "node.js");

let added = await corpus.fill();
console.log(
	added.length > 0 ? `Downloaded ${added.join(", ")}` : "Corpus is up to date",
);

let result = await Bun.build({
	entrypoints: [join(import.meta.dirname, "run.ts")],
	target: "node",
	packages: "external",
});

if (!result.success) {
	for (let log of result.logs) console.error(log);
	process.exit(1);
}

await Bun.write(OUTFILE, result.outputs[0]);
console.log(`Built ${OUTFILE.slice(process.cwd().length + 1)}`);
