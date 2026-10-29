import { escapeAttribute, escapeText } from "entities/escape";

import * as select from "../select";
import * as tree from "../tree";
import * as values from "../values";

import type { Selector } from "../select";
import type { Tree } from "../tree";

export type Kind = "document" | "element" | "text" | "comment" | "directive";

/**
 * One node of a mutable tree. Public classes are thin views over this.
 */
export type State = {
	kind: Kind;
	/** The document this node belongs to; `undefined` for a document. */
	doc: State | undefined;
	parent: State | undefined;
	/** Source that `start`, `end`, and `tree` refer to; empty for new nodes. */
	source: string;
	tree: Tree | undefined;
	id: number;
	start: number;
	end: number;
	name: string;
	children: State[];
	/** Frozen; replaced, never mutated. Read lazily from `tree` when unset. */
	attrs: Readonly<Record<string, string>> | undefined;
	/** Names of added attributes as written, by lowercase name, when they differ. */
	names: Readonly<Record<string, string>> | undefined;
	/** Leaf value, decoded or set; read lazily from `tree` when unset. */
	value: string | undefined;
	/** The opening tag or leaf value no longer matches the source. */
	changed: boolean;
	/** The serialized output no longer matches the source. */
	dirty: boolean;
	/** The public view, created on first access. */
	view: unknown;
};

const KINDS: Record<number, Kind> = {
	[tree.DOCUMENT]: "document",
	[tree.ELEMENT]: "element",
	[tree.TEXT]: "text",
	[tree.COMMENT]: "comment",
	[tree.DIRECTIVE]: "directive",
};

export function docOf(s: State): State {
	return s.doc ?? s;
}

function create(kind: Kind, doc: State | undefined, name = ""): State {
	return {
		kind,
		doc,
		parent: undefined,
		source: "",
		tree: undefined,
		id: -1,
		start: -1,
		end: -1,
		name,
		children: [],
		attrs: undefined,
		names: undefined,
		value: undefined,
		changed: true,
		dirty: true,
		view: undefined,
	};
}

/**
 * Materialize every node of `t` for `doc`.
 * Returns the top-level states, which have no parent yet.
 */
export function load(t: Tree, doc: State): State[] {
	let states: State[] = [];
	let top: State[] = [];

	for (let id = 1; id < t.kind.length; id++) {
		let state: State = {
			kind: KINDS[t.kind[id]],
			doc,
			parent: undefined,
			source: t.source,
			tree: t,
			id,
			start: t.start[id],
			end: t.end[id],
			name: t.name[id],
			children: [],
			attrs: undefined,
			names: undefined,
			value: undefined,
			changed: false,
			dirty: false,
			view: undefined,
		};
		states[id] = state;

		let p = t.parent[id];
		if (p === 0) top.push(state);
		else {
			state.parent = states[p];
			states[p].children.push(state);
		}
	}

	return top;
}

/**
 * Parse `source` into a document state.
 */
export function document(source: string): State {
	let t = tree.build(source);
	let doc = create("document", undefined);
	doc.source = source;
	doc.tree = t;
	doc.id = 0;
	doc.start = 0;
	doc.end = source.length;
	doc.changed = false;
	doc.dirty = false;

	for (let child of load(t, doc)) {
		child.parent = doc;
		doc.children.push(child);
	}
	return doc;
}

export function attributes(s: State): Readonly<Record<string, string>> {
	if (!s.attrs)
		s.attrs = s.tree ? values.attributes(s.tree, s.id) : Object.freeze({});
	return s.attrs;
}

export function value(s: State): string {
	if (s.value === undefined) s.value = s.tree ? values.value(s.tree, s.id) : "";
	return s.value;
}

export function text(s: State): string {
	if (s.kind === "text") return value(s);
	let output = "";
	for (let child of s.children) {
		if (child.kind === "text") output += value(child);
		else if (child.kind === "element") output += text(child);
	}
	return output;
}

function touch(s: State | undefined): void {
	for (let x = s; x && !x.dirty; x = x.parent) x.dirty = true;
}

function adopt(s: State, doc: State): void {
	if (docOf(s) === doc) return;
	s.doc = doc;
	for (let child of s.children) adopt(child, doc);
}

export function detach(s: State): void {
	let p = s.parent;
	if (!p) return;
	let at = p.children.indexOf(s);
	if (at !== -1) p.children.splice(at, 1);
	s.parent = undefined;
	touch(p);
}

/**
 * Insert `items` into `parent` at `index`, moving them from wherever they are.
 * @throws {TypeError} on void elements, documents, or cycles.
 */
export function insert(parent: State, index: number, items: State[]): void {
	if (parent.kind === "element" && tree.VOID.has(parent.name)) {
		throw new TypeError(`Cannot add children to <${parent.name}>`);
	}

	for (let item of items) {
		if (item.kind === "document")
			throw new TypeError("Cannot insert a document");
		for (let x: State | undefined = parent; x; x = x.parent) {
			if (x === item) throw new TypeError("Cannot insert a node into itself");
		}
	}

	let at = index;
	for (let item of items) {
		if (item.parent === parent && parent.children.indexOf(item) < at) at--;
		detach(item);
	}

	for (let item of items) {
		adopt(item, docOf(parent));
		item.parent = parent;
	}

	parent.children.splice(at, 0, ...items);
	touch(parent);
}

/**
 * A deep copy of `s` without a parent. Unedited parts still serialize from the source as written.
 */
export function clone(s: State): State {
	let copy: State = { ...s, parent: undefined, children: [], view: undefined };
	for (let child of s.children) {
		let next = clone(child);
		next.parent = copy;
		copy.children.push(next);
	}
	return copy;
}

export function textNode(doc: State, input: string): State {
	let s = create("text", doc);
	s.value = input;
	return s;
}

/**
 * Parse an HTML fragment into new top-level states for `doc`.
 */
export function fragment(doc: State, html: string, foreign: boolean): State[] {
	return load(tree.build(html, foreign), doc);
}

/**
 * Set attribute `name`, ignoring case. A new attribute keeps `name` as written.
 */
export function setAttribute(s: State, name: string, value: string): void {
	let key = name.toLowerCase();
	let attrs = attributes(s);
	if (key !== name && !Object.hasOwn(attrs, key)) {
		s.names = Object.freeze({ ...s.names, [key]: name });
	}
	s.attrs = Object.freeze({ ...attrs, [key]: value });
	s.changed = true;
	touch(s);
}

/**
 * Remove attribute `key`, where `key` is lowercase.
 */
export function removeAttribute(s: State, key: string): void {
	let attrs = attributes(s);
	if (!Object.hasOwn(attrs, key)) return;
	let { [key]: _, ...rest } = attrs;
	s.attrs = Object.freeze(rest);
	if (s.names && Object.hasOwn(s.names, key)) {
		let { [key]: _, ...names } = s.names;
		s.names = Object.freeze(names);
	}
	s.changed = true;
	touch(s);
}

/**
 * Rename element `s` to `input`, with the parser's name rules for where `s` is.
 * @throws {TypeError} when the name is a void element and `s` has children,
 * or a raw text element, like `script`, and `s` has child elements.
 */
export function rename(s: State, input: string): void {
	let lower = input.toLowerCase();
	let inside = within(s);
	let name = inside
		? (tree.SVG.get(lower) ?? lower)
		: lower === "image"
			? "img"
			: lower;
	if (tree.VOID.has(name) && s.children.length > 0) {
		throw new TypeError(`Cannot rename <${s.name}> with children to <${name}>`);
	}
	let raw = !inside && tree.RAW.has(name);
	if (raw && s.children.some((x) => x.kind === "element")) {
		throw new TypeError(
			`Cannot rename <${s.name}> with child elements to <${name}>`,
		);
	}
	s.name = name;
	s.changed = true;
	touch(s);
}

export function setValue(s: State, input: string): void {
	s.value = input;
	s.changed = true;
	touch(s);
}

export function replaceChildren(s: State, items: State[]): void {
	for (let child of [...s.children]) detach(child);
	insert(s, 0, items);
}

/** An attribute that can be copied as written: not empty, and not ending in a space or `=`. */
const INTACT = /[^\s=]$/;

/**
 * Attributes from `entries[from]` on, written as new attributes.
 */
function added(s: State, entries: [string, string][], from: number): string {
	let output = "";
	for (let i = from; i < entries.length; i++) {
		let [key, val] = entries[i];
		output += ` ${s.names?.[key] ?? key}="${escapeAttribute(val)}"`;
	}
	return output;
}

/**
 * The opening tag of `s`, ending in `/>` when `slash` is set. When attributes
 * were only added, the source tag is copied as written, plus the new ones.
 * Else the tag is rebuilt, and unedited attributes are copied as written.
 */
function open(s: State, slash: boolean): string {
	let t = s.tree;
	let entries = Object.entries(attributes(s));
	if (!t) return end("<" + s.name + added(s, entries, 0), slash);

	let list = values.pairs(t, s.id);
	let count = list.length / 2;
	let kept = entries.length >= count;
	for (let i = 0; kept && i < count; i++) {
		kept = entries[i][0] === list[2 * i] && entries[i][1] === list[2 * i + 1];
	}

	let bare = selfClosed(t, s);
	let last = count > 0 ? list[list.length - 1] : undefined;
	let extra = kept ? added(s, entries, count) : "";
	if (kept && !(extra && last === "")) {
		let head = t.head[s.id];
		let rest = s.source.slice(head, t.from[s.id] - 1).trimEnd();
		if (bare) rest = rest.slice(0, -1).trimEnd();
		let name =
			s.name === t.name[s.id] ? s.source.slice(s.start, head) : "<" + s.name;
		return end(name + rest + extra, slash);
	}

	let spans = values.spans(t, s.id);
	let output = "<" + s.name;
	for (let [key, val] of entries) {
		let at = values.find(spans, key, 3);
		let raw = at === -1 ? "" : spans[at + 2];
		if (INTACT.test(raw) && val === values.attribute(t, s.id, key)) {
			output += " " + raw;
			continue;
		}
		let name = s.names?.[key] ?? (at === -1 ? key : spans[at + 1]);
		output += ` ${name}="${escapeAttribute(val)}"`;
	}
	return end(output, slash);
}

/**
 * Close a start tag with `>`, or with `/>` when `slash` is set. A space goes
 * before `/>` unless a quote ends the tag, so an unquoted value keeps its value.
 */
function end(tag: string, slash: boolean): string {
	if (!slash) return tag + ">";
	let c = tag.charCodeAt(tag.length - 1);
	return tag + (c === 34 || c === 39 ? "/>" : " />");
}

/**
 * Whether the source tag of `s` ends with `/>` and has nothing parsed inside it.
 */
function selfClosed(t: Tree, s: State): boolean {
	if (t.from[s.id] !== t.end[s.id]) return false;
	return tree.selfClosing(s.source, t.head[s.id]);
}

/**
 * Whether element `s`, in `parent` before `next`, needs an end tag that its
 * source omits, because what closed it in the source no longer follows it.
 */
function unclosed(s: State, parent: State, next: State | undefined): boolean {
	let t = s.tree;
	if (s.kind !== "element" || !t || s.name !== t.name[s.id]) return false;
	let id = s.id;
	if (t.to[id] !== t.end[id] || tree.VOID.has(s.name)) return false;
	if (selfClosed(t, s) || s.source.charCodeAt(s.start + 1) === 47) return false;

	let after = t.stop[id];
	let sibling = after < t.kind.length && t.parent[after] === t.parent[id];
	if (next) {
		let same = next.tree === t && next.id === after;
		return !(sibling && same && next.name === t.name[after]);
	}
	if (ended(parent)) return false;
	return sibling || parent.tree !== t || parent.id !== t.parent[id];
}

/**
 * Whether `s` is written with an end tag, or is the document, so that its
 * end closes every element still open inside it.
 */
function ended(s: State): boolean {
	let t = s.tree;
	if (s.kind !== "element" || !t || s.name !== t.name[s.id]) return true;
	return selfClosed(t, s) || t.to[s.id] !== t.end[s.id];
}

/**
 * The serialized children of `s`.
 */
function content(s: State): string {
	let output = "";
	let list = s.children;
	for (let i = 0; i < list.length; i++) {
		let child = list[i];
		output += serialize(child);
		if (unclosed(child, s, list[i + 1])) output += `</${child.name}>`;
	}
	return output;
}

/**
 * Whether the children of `s` are foreign content, like the inside of `<svg>`.
 */
export function foreign(s: State): boolean {
	if (s.kind !== "element") return false;
	if (tree.FOREIGN.has(s.name)) return true;
	if (tree.INTEGRATION.has(s.name)) return false;
	return within(s);
}

/**
 * Whether `s` is in foreign content. A detached node keeps the context it was parsed in.
 */
export function within(s: State): boolean {
	if (s.parent) return foreign(s.parent);
	let t = s.tree;
	return (
		t !== undefined && s.kind !== "document" && tree.foreign(t, t.parent[s.id])
	);
}

/**
 * How text is written in an element: escaped, raw like `<title>`, or literal like `<script>`.
 */
function mode(name: string, foreign: boolean): number {
	if (foreign || !tree.RAW.has(name)) return 0;
	return values.LITERAL.has(name) ? 2 : 1;
}

/**
 * How text is written in `s`, where it is now.
 */
function current(s: State | undefined): number {
	if (!s || s.kind !== "element" || !tree.RAW.has(s.name)) return 0;
	return mode(s.name, within(s));
}

/**
 * Whether `s` is text that moved to a parent that writes text differently, so its source no longer fits.
 */
function misplaced(s: State): boolean {
	let t = s.tree;
	if (s.kind !== "text" || !t || !s.parent) return false;
	let p = t.parent[s.id];
	let before = tree.RAW.has(t.name[p])
		? mode(t.name[p], tree.foreign(t, t.parent[p]))
		: 0;
	return current(s.parent) !== before;
}

/**
 * Serialize `s`. Unchanged subtrees are copied from the source as written.
 */
export function serialize(s: State): string {
	if (!s.dirty && !misplaced(s)) return s.source.slice(s.start, s.end);

	switch (s.kind) {
		case "document":
			return content(s);
		case "text":
			return current(s.parent) === 2 ? value(s) : escapeText(value(s));
		case "comment":
			return `<!--${value(s)}-->`;
		case "directive":
			return `<!${value(s)}>`;
		case "element": {
			let t = s.tree;
			let body = content(s);
			let bare = t !== undefined && selfClosed(t, s);
			let own = t !== undefined && s.name === t.name[s.id];
			if (t && own && !(bare && s.children.length > 0)) {
				let head = s.changed
					? open(s, bare)
					: s.source.slice(s.start, t.from[s.id]);
				return head + body + s.source.slice(t.to[s.id], s.end);
			}
			let tail = tree.VOID.has(s.name) ? "" : `</${s.name}>`;
			return open(s, false) + body + tail;
		}
	}
}

/**
 * Inner HTML of an element or document.
 */
export function inner(s: State): string {
	let t = s.tree;
	if (!s.dirty && t) return s.source.slice(t.from[s.id], t.to[s.id]);
	return content(s);
}

const matcher = select.engine<undefined, State>({
	name: (_, s) => s.name,
	attr(_, s, key) {
		let attrs = attributes(s);
		return Object.hasOwn(attrs, key) ? attrs[key] : undefined;
	},
	parent(_, s) {
		let p = s.parent;
		return p && p.kind === "element" ? p : undefined;
	},
	siblings(_, s) {
		let p = s.parent;
		return p ? p.children.filter((x) => x.kind === "element") : [s];
	},
	empty(_, s) {
		return !s.children.some((x) => x.kind === "element" || x.kind === "text");
	},
});

export function matches(s: State, list: Selector): boolean {
	return s.kind === "element" && matcher(undefined, s, list);
}

/**
 * Descendant elements of `root` that match `list`, in document order.
 * Like css-select, skips the contents of `<template>` elements below `root`.
 */
export function all(root: State, list: Selector, limit = Infinity): State[] {
	let output: State[] = [];
	let stack = [...root.children].reverse();

	for (let s = stack.pop(); s; s = stack.pop()) {
		if (s.kind !== "element") continue;
		if (matcher(undefined, s, list)) {
			output.push(s);
			if (output.length >= limit) break;
		}
		if (s.name === "template") continue;
		for (let i = s.children.length - 1; i >= 0; i--) stack.push(s.children[i]);
	}

	return output;
}
