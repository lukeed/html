import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decodeHTML, decodeHTMLAttribute } from "entities/decode";
import { NAMED, LEGACY } from "./data";
import { decode } from "./decode";

let cases: string[] = [];
for (let name of [...Object.keys(NAMED), ...LEGACY]) {
	for (let tail of ["", ";", ";x", "x", "=", " y", "1", ";;", "&amp;"])
		cases.push(`&${name}${tail}`, `a&${name}${tail}b`);
}
for (let n of [
	0, 9, 65, 127, 128, 129, 141, 150, 159, 160, 0xd800, 0xdfff, 0xfffe, 0x10ffff,
	0x110000, 99999999999,
]) {
	cases.push(
		`&#${n};`,
		`&#${n}`,
		`&#x${n.toString(16)};`,
		`&#X${n.toString(16)}z`,
	);
}
cases.push(
	"&#;",
	"&#x;",
	"&#",
	"&#x",
	"&",
	"&&",
	"&;",
	"& amp;",
	"&#65&#66;",
	"&amp&lt",
	"&notin",
	"&notit;",
	"&ampx;",
	"&AMP",
	"&AMPx=",
);

let alphabet = [
	"&",
	"#",
	"x",
	"X",
	";",
	"=",
	"a",
	"m",
	"p",
	"l",
	"t",
	"g",
	"n",
	"o",
	"i",
	"0",
	"9",
	"A",
	"F",
	" ",
	"q",
	"u",
	"c",
	"y",
];
let seed = 1;
let rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 200000; i++) {
	let s = "";
	let len = 1 + Math.floor(rand() * 14);
	for (let k = 0; k < len; k++)
		s += alphabet[Math.floor(rand() * alphabet.length)];
	cases.push(s);
}

let dir = join(import.meta.dirname, "../corpus");
let corpus = 0;
for (let file of readdirSync(dir)) {
	let html = readFileSync(`${dir}/${file}`, "utf8");
	for (let m of html.matchAll(/="([^"]*&[^"]*)"/g)) {
		cases.push(m[1]);
		corpus++;
	}
	for (let m of html.matchAll(/>([^<]*&[^<]*)</g)) {
		cases.push(m[1]);
		corpus++;
	}
}

let fails = 0;
for (let s of cases) {
	for (let [mode, ref] of [
		[false, decodeHTML],
		[true, decodeHTMLAttribute],
	] as const) {
		let a = decode(s, mode);
		let b = ref(s);
		if (a !== b) {
			if (fails++ < 15)
				console.log(
					mode ? "attr" : "text",
					JSON.stringify(s),
					"ours",
					JSON.stringify(a),
					"entities",
					JSON.stringify(b),
				);
		}
	}
}
console.log(
	`${cases.length} cases (${corpus} from corpus), ${fails} differences`,
);
