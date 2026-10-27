import { LEGACY, NAMED } from "./data";

const WINDOWS_1252: Record<number, number> = {
	0x80: 0x20ac,
	0x82: 0x201a,
	0x83: 0x0192,
	0x84: 0x201e,
	0x85: 0x2026,
	0x86: 0x2020,
	0x87: 0x2021,
	0x88: 0x02c6,
	0x89: 0x2030,
	0x8a: 0x0160,
	0x8b: 0x2039,
	0x8c: 0x0152,
	0x8e: 0x017d,
	0x91: 0x2018,
	0x92: 0x2019,
	0x93: 0x201c,
	0x94: 0x201d,
	0x95: 0x2022,
	0x96: 0x2013,
	0x97: 0x2014,
	0x98: 0x02dc,
	0x99: 0x2122,
	0x9a: 0x0161,
	0x9b: 0x203a,
	0x9c: 0x0153,
	0x9e: 0x017e,
	0x9f: 0x0178,
};

let named: Map<string, string> | undefined;
let legacy: Set<string> | undefined;

function isAlnum(c: number): boolean {
	return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isHex(c: number): boolean {
	return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

function codepoint(cp: number): string {
	if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
	return String.fromCodePoint(WINDOWS_1252[cp] ?? cp);
}

/**
 * Decode character references in `input`, following the HTML spec.
 * In attribute mode, a legacy reference without `;` followed by `=` or an
 * alphanumeric is left as written.
 */
export function decode(input: string, attribute: boolean): string {
	let amp = input.indexOf("&");
	if (amp === -1) return input;

	named ??= new Map(Object.entries(NAMED));
	legacy ??= new Set(LEGACY);

	let output = "";
	let last = 0;
	let n = input.length;

	while (amp !== -1) {
		let i = amp + 1;
		let c = input.charCodeAt(i);

		let fast =
			c === 113 &&
			input.charCodeAt(i + 1) === 117 &&
			input.charCodeAt(i + 2) === 111 &&
			input.charCodeAt(i + 3) === 116 &&
			input.charCodeAt(i + 4) === 59
				? 5
				: c === 97 &&
					  input.charCodeAt(i + 1) === 109 &&
					  input.charCodeAt(i + 2) === 112 &&
					  input.charCodeAt(i + 3) === 59
					? 4
					: (c === 108 || c === 103) &&
						  input.charCodeAt(i + 1) === 116 &&
						  input.charCodeAt(i + 2) === 59
						? 3
						: 0;
		if (fast > 0) {
			output +=
				input.slice(last, amp) +
				(fast === 5 ? '"' : fast === 4 ? "&" : c === 108 ? "<" : ">");
			last = i + fast;
			amp = input.indexOf("&", last);
			continue;
		}

		if (c === 35) {
			let j = i + 1;
			let hex = input.charCodeAt(j) === 120 || input.charCodeAt(j) === 88;
			if (hex) j++;
			let from = j;
			let cp = 0;
			while (j < n) {
				let d = input.charCodeAt(j);
				if (hex ? !isHex(d) : d < 48 || d > 57) break;
				if (cp <= 0x10ffff)
					cp = cp * (hex ? 16 : 10) + (d <= 57 ? d - 48 : (d | 32) - 87);
				j++;
			}
			if (j > from) {
				if (input.charCodeAt(j) === 59) j++;
				output += input.slice(last, amp) + codepoint(cp);
				last = j;
			}
			amp = input.indexOf("&", j > from ? j : i);
			continue;
		}

		let j = i;
		while (j < n && j - i < 32 && isAlnum(input.charCodeAt(j))) j++;

		if (j > i) {
			let word = input.slice(i, j);
			let value = input.charCodeAt(j) === 59 ? named.get(word) : undefined;
			if (value !== undefined) {
				output += input.slice(last, amp) + value;
				last = j + 1;
				amp = input.indexOf("&", last);
				continue;
			}

			for (let k = Math.min(word.length, 6); k > 1; k--) {
				let name = word.slice(0, k);
				if (!legacy.has(name)) continue;
				let next = input.charCodeAt(i + k);
				if (attribute && (next === 61 || isAlnum(next))) break;
				output += input.slice(last, amp) + named.get(name);
				last = i + k;
				break;
			}
		}

		amp = input.indexOf("&", i);
	}

	return last === 0 ? input : output + input.slice(last);
}
