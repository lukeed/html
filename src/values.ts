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

/** Offsets of the last attribute read by {@link scan}. */
const AT = new Int32Array(4);

/**
 * Read the next attribute of a tag from `i` up to `end` into {@link AT}, as
 * name start, name end, value start, and value end. Returns the offset after
 * it, or `-1` when no attribute is left.
 */
function scan(source: string, i: number, end: number): number {
	while (i < end) {
		let c = source.charCodeAt(i);
		if (!(isBreak(c) || c === 34 || c === 39)) break;
		i++;
	}
	if (i >= end) return -1;

	AT[0] = i;
	while (i < end && isName(source.charCodeAt(i))) i++;
	AT[1] = AT[2] = AT[3] = i;

	let at = i;
	while (at < end && isSpace(source.charCodeAt(at))) at++;
	if (source.charCodeAt(at) !== 61) return i;

	i = at + 1;
	while (i < end && isSpace(source.charCodeAt(i))) i++;
	let quote = source.charCodeAt(i);
	if (quote === 34 || quote === 39) {
		let close = source.indexOf(quote === 34 ? '"' : "'", i + 1);
		if (close === -1 || close > end) close = end;
		AT[2] = i + 1;
		AT[3] = close;
		return close + 1;
	}

	AT[2] = i;
	while (i < end && !isSpace(source.charCodeAt(i))) i++;
	AT[3] = i;
	return i;
}

/**
 * Parse the attributes of element `id` into `[name, value, ...]`. Names are
 * lowercased; the first of any duplicate names wins. Values are entity-decoded.
 */
export function pairs(t: Tree, id: number): string[] {
	let cached = t.pairs[id];
	if (cached) return cached;

	let output: string[] = [];
	let source = t.source;
	let end = t.from[id] - 1;

	let i = scan(source, t.head[id], end);
	for (; i !== -1; i = scan(source, i, end)) {
		let key = source.slice(AT[0], AT[1]).toLowerCase();
		if (find(output, key) !== -1) continue;
		let value = source.slice(AT[2], AT[3]);
		output.push(key, value.includes("&") ? decodeHTMLAttribute(value) : value);
	}

	t.pairs[id] = output;
	return output;
}

/**
 * The attributes of element `id` as written, as `[key, name, raw, ...]`: the
 * lowercase name, the name as written, and the whole attribute as written.
 * The first of any duplicate names wins, like {@link pairs}.
 */
export function spans(t: Tree, id: number): string[] {
	let output: string[] = [];
	let source = t.source;
	let end = t.from[id] - 1;

	let i = scan(source, t.head[id], end);
	for (; i !== -1; i = scan(source, i, end)) {
		let name = source.slice(AT[0], AT[1]);
		let key = name.toLowerCase();
		if (find(output, key, 3) !== -1) continue;
		output.push(key, name, source.slice(AT[0], Math.min(i, end)));
	}

	return output;
}

/**
 * The index of `key` in a flat list of records that are `stride` long.
 */
export function find(list: string[], key: string, stride = 2): number {
	for (let i = 0; i < list.length; i += stride) if (list[i] === key) return i;
	return -1;
}

/**
 * The value of attribute `key` on element `id`, where `key` is lowercase.
 */
export function attribute(
	t: Tree,
	id: number,
	key: string,
): string | undefined {
	let list = pairs(t, id);
	let i = find(list, key);
	return i === -1 ? undefined : list[i + 1];
}

/**
 * The attributes of element `id` as a frozen record.
 */
export function attributes(
	t: Tree,
	id: number,
): Readonly<Record<string, string>> {
	let cached = t.attrs[id];
	if (cached) return cached;

	let list = pairs(t, id);
	let output: Record<string, string> = {};
	for (let i = 0; i < list.length; i += 2) output[list[i]] = list[i + 1];
	return (t.attrs[id] = Object.freeze(output));
}

/**
 * The decoded value of a text or comment node.
 * Text inside raw text elements, like `<script>`, is not decoded.
 */
export function value(t: Tree, id: number): string {
	let raw = t.source.slice(t.from[id], t.to[id]);
	if (t.kind[id] !== tree.TEXT || !raw.includes("&")) return raw;
	let p = t.parent[id];
	let literal = LITERAL.has(t.name[p]) && !tree.foreign(t, t.parent[p]);
	return literal ? raw : decodeHTML(raw);
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
