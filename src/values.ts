import { decodeHTML, decodeHTMLAttribute } from "entities/decode";

import * as tree from "./tree";

import type { Tree } from "./tree";

const ATTR =
	/([^\s"'>/=][^\s"'>/=]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const LITERAL = new Set([
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
	let output: Record<string, string> = {};
	let end = t.from[id] - 1;

	let segment = t.source.slice(t.head[id], end);
	ATTR.lastIndex = 0;

	for (let match; (match = ATTR.exec(segment));) {
		let key = match[1].toLowerCase();
		if (Object.hasOwn(output, key)) continue;
		let raw = match[2] ?? match[3] ?? match[4] ?? "";
		output[key] = raw.includes("&") ? decodeHTMLAttribute(raw) : raw;
	}

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
