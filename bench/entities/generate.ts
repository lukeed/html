import { writeFile } from "node:fs/promises";
import { join } from "node:path";

type Entity = { codepoints: number[]; characters: string };

function isList(input: unknown): input is Record<string, Entity> {
	if (typeof input !== "object" || input === null) return false;
	return Object.values(input).every(
		(x) =>
			typeof x === "object" &&
			x !== null &&
			"characters" in x &&
			typeof x.characters === "string",
	);
}

let res = await fetch("https://html.spec.whatwg.org/entities.json");
let list: unknown = await res.json();
if (!isList(list)) throw new Error("Unexpected entities.json format");
let names = Object.keys(list).sort();

let named = Object.fromEntries(
	names
		.filter((x) => x.endsWith(";"))
		.map((x) => [x.slice(1, -1), list[x].characters]),
);
let legacy = names.filter((x) => !x.endsWith(";")).map((x) => x.slice(1));

await writeFile(
	join(import.meta.dirname, "data.ts"),
	`export const NAMED: Record<string, string> = ${JSON.stringify(named)};\nexport const LEGACY: string[] = ${JSON.stringify(legacy)};\n`,
);
