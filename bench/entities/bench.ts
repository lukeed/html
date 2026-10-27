import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decodeHTML, decodeHTMLAttribute } from "entities/decode";
import { bench, do_not_optimize, group, run, summary } from "mitata";
import { NAMED } from "./data";
import { decode } from "./decode";

let dir = join(import.meta.dirname, "../corpus");
let texts: string[] = [];
let attrs: string[] = [];
for (let file of readdirSync(dir)) {
	let html = readFileSync(`${dir}/${file}`, "utf8");
	for (let m of html.matchAll(/="([^"]*&[^"]*)"/g)) attrs.push(m[1]);
	for (let m of html.matchAll(/>([^<]*&[^<]*)</g)) texts.push(m[1]);
}
let dense = Object.keys(NAMED)
	.map((x) => `x &${x}; y`)
	.join("");
let numeric = Array.from(
	{ length: 2000 },
	(_, i) => `&#${i + 32};&#x${(i + 32).toString(16)};`,
).join(" ");
console.log(
	`${texts.length} text, ${attrs.length} attribute strings; dense ${dense.length} chars`,
);

summary(() => {
	group("corpus text", () => {
		bench("entities", () => {
			for (let s of texts) do_not_optimize(decodeHTML(s));
		}).gc("inner");
		bench("prototype", () => {
			for (let s of texts) do_not_optimize(decode(s, false));
		}).gc("inner");
	});
	group("corpus attributes", () => {
		bench("entities", () => {
			for (let s of attrs) do_not_optimize(decodeHTMLAttribute(s));
		}).gc("inner");
		bench("prototype", () => {
			for (let s of attrs) do_not_optimize(decode(s, true));
		}).gc("inner");
	});
	group("every named entity", () => {
		bench("entities", () => do_not_optimize(decodeHTML(dense))).gc("inner");
		bench("prototype", () => do_not_optimize(decode(dense, false))).gc("inner");
	});
	group("numeric", () => {
		bench("entities", () => do_not_optimize(decodeHTML(numeric))).gc("inner");
		bench("prototype", () => do_not_optimize(decode(numeric, false))).gc(
			"inner",
		);
	});
});
await run({ colors: false });
