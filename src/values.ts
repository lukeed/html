import { decodeHTML, decodeHTMLAttribute } from "entities/decode";

import * as tree from "./tree";

import type { Tree } from "./tree";

function isSpace(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

function isBreak(c: number): boolean {
	return isSpace(c) || c === 47 || c === 61 || c === 62;
}

function isName(c: number): boolean {
	return !(isBreak(c) || c === 34 || c === 39);
}

export const LITERAL = new Set([
	"script",
	"style",
	"xmp",
	"iframe",
	"noembed",
	"noframes",
	"plaintext",
]);

/**
 * Parse the attributes of element `id`. Names are lowercased; the first of
 * any duplicate names wins. Values are entity-decoded.
 */
export function attributes(t: Tree, id: number): Record<string, string> {
	let cached = t.attrs[id];
	if (cached) return cached;

	let output: Record<string, string> = {};
	let source = t.source;
	let end = t.from[id] - 1;
	let i = t.head[id];

	while (i < end) {
		let c = source.charCodeAt(i);
		if (isBreak(c) || c === 34 || c === 39) {
			i++;
			continue;
		}

		let from = i;
		while (i < end && isName(source.charCodeAt(i))) i++;
		let key = source.slice(from, i).toLowerCase();

		let at = i;
		while (at < end && isSpace(source.charCodeAt(at))) at++;

		let value = "";
		if (source.charCodeAt(at) === 61) {
			i = at + 1;
			while (i < end && isSpace(source.charCodeAt(i))) i++;
			let quote = source.charCodeAt(i);
			if (quote === 34 || quote === 39) {
				let close = source.indexOf(quote === 34 ? '"' : "'", i + 1);
				if (close === -1 || close > end) close = end;
				value = source.slice(i + 1, close);
				i = close + 1;
			} else {
				let v = i;
				while (i < end && !isSpace(source.charCodeAt(i))) i++;
				value = source.slice(v, i);
			}
		}

		if (Object.hasOwn(output, key)) continue;
		output[key] = value.includes("&") ? decodeHTMLAttribute(value) : value;
	}

	t.attrs[id] = Object.freeze(output);
	return output;
}

/**
 * The decoded value of a text or comment node.
 * Text inside raw text elements, like `<script>`, is not decoded.
 */
export function value(t: Tree, id: number): string {
	let raw = t.source.slice(t.from[id], t.to[id]);
	if (t.kind[id] !== tree.TEXT || !raw.includes("&")) return raw;
	return LITERAL.has(t.name[t.parent[id]]) ? raw : decodeHTML(raw);
}

/**
 * The decoded text of every text node inside `id`, in order.
 */
export function text(t: Tree, id: number): string {
	if (t.kind[id] === tree.TEXT) return value(t, id);

	let output = "";
	for (let x = id + 1; x < t.stop[id]; x++) {
		if (t.kind[x] === tree.TEXT) output += value(t, x);
	}
	return output;
}
