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

export function textNode(doc: State, input: string): State {
	let s = create("text", doc);
	s.value = input;
	return s;
}

/**
 * Parse an HTML fragment into new top-level states for `doc`.
 */
export function fragment(doc: State, html: string): State[] {
	return load(tree.build(html), doc);
}

export function setAttributes(s: State, next: Record<string, string>): void {
	s.attrs = Object.freeze(next);
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

function open(s: State): string {
	let output = "<" + s.name;
	for (let [key, val] of Object.entries(attributes(s))) {
		output += val === "" ? " " + key : ` ${key}="${escapeAttribute(val)}"`;
	}
	return output + ">";
}

/**
 * Serialize `s`. Unchanged subtrees are copied from the source as written.
 */
export function serialize(s: State): string {
	if (!s.dirty) return s.source.slice(s.start, s.end);

	switch (s.kind) {
		case "document":
			return s.children.map(serialize).join("");
		case "text": {
			let raw = s.parent && values.LITERAL.has(s.parent.name);
			return raw ? value(s) : escapeText(value(s));
		}
		case "comment":
			return `<!--${value(s)}-->`;
		case "directive":
			return `<!${value(s)}>`;
		case "element": {
			let t = s.tree;
			let head =
				t && !s.changed ? s.source.slice(s.start, t.from[s.id]) : open(s);
			let tail = t
				? s.source.slice(t.to[s.id], s.end)
				: tree.VOID.has(s.name)
					? ""
					: `</${s.name}>`;
			return head + s.children.map(serialize).join("") + tail;
		}
	}
}

/**
 * Inner HTML of an element or document.
 */
export function inner(s: State): string {
	let t = s.tree;
	if (!s.dirty && t) return s.source.slice(t.from[s.id], t.to[s.id]);
	return s.children.map(serialize).join("");
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
