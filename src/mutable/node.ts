import { decodeHTML } from "entities/decode";

import * as position from "../position";
import * as select from "../select";
import * as tree from "../tree";
import * as values from "../values";
import * as state from "./state";

import type { Position } from "../position";
import type { State } from "./state";

export type { Position } from "../position";

export type Node = Element | Text | Comment | Directive;
export type Parent = Element | Document;
/** A node to insert, or a string to insert as text. */
export type Content = Node | string;

const NAME = /^[^\s"'>/=]+$/;
const TAG = /^[a-z][^\s"'<>/=]*$/i;

let read: (node: Base) => State;
const LINES = new WeakMap<State, number[]>();

function view(s: State): Node | Document {
	let found = s.view;
	if (
		found instanceof Document ||
		found instanceof Element ||
		found instanceof Text ||
		found instanceof Comment ||
		found instanceof Directive
	) {
		return found;
	}

	let created =
		s.kind === "document"
			? new Document(s)
			: s.kind === "element"
				? new Element(s)
				: s.kind === "text"
					? new Text(s)
					: s.kind === "comment"
						? new Comment(s)
						: new Directive(s);
	s.view = created;
	return created;
}

function element(s: State): Element {
	let found = view(s);
	if (found instanceof Element) return found;
	throw new TypeError(`Expected an element, got ${s.kind}`);
}

function node(s: State): Node {
	let found = view(s);
	if (found instanceof Document)
		throw new TypeError("Expected a node, got document");
	return found;
}

function parent(s: State): Parent | undefined {
	let p = s.parent;
	if (!p) return;
	let found = view(p);
	return found instanceof Document || found instanceof Element
		? found
		: undefined;
}

function copy<T extends Node>(type: new (s: State) => T, node: T): T {
	let found = view(state.clone(read(node)));
	if (found instanceof type) return found;
	throw new TypeError(`Expected a copy of ${node.type}`);
}

function contents(target: State, items: Content[]): State[] {
	let doc = state.docOf(target);
	return items.map((x) =>
		typeof x === "string" ? state.textNode(doc, x) : read(x),
	);
}

function offset(s: State, key: "start" | "end"): number | undefined {
	return s.tree && s.source === state.docOf(s).source ? s[key] : undefined;
}

function find(s: State, selector: string): Element | undefined {
	let [found] = state.all(s, select.compile(selector), 1);
	return found && element(found);
}

function all(s: State, selector: string): Element[] {
	return state.all(s, select.compile(selector)).map(element);
}

function index(s: State): [State, number] {
	let p = s.parent;
	if (!p) throw new TypeError("Node has no parent");
	return [p, p.children.indexOf(s)];
}

class Base {
	#s: State;

	/** @internal */
	constructor(s: State) {
		this.#s = s;
	}

	static {
		read = (node) => node.#s;
	}
}

/**
 * Methods shared by every node that can have a parent.
 */
class Child extends Base {
	/** Source offset where this node begins, or `undefined` if it was not parsed from `document.source`. */
	get start(): number | undefined {
		return offset(read(this), "start");
	}

	/** Source offset where this node ends, or `undefined` if it was not parsed from `document.source`. */
	get end(): number | undefined {
		return offset(read(this), "end");
	}

	/** The parent, or `undefined` once removed. */
	get parent(): Parent | undefined {
		return parent(read(this));
	}

	/** The document this node belongs to. */
	get document(): Document {
		let doc = view(state.docOf(read(this)));
		if (doc instanceof Document) return doc;
		throw new TypeError("Node is not in a document");
	}

	/**
	 * Insert nodes or text before this node.
	 * @example
	 * let doc = parse("<p>b</p>");
	 * doc.find("p")?.before("a");
	 * stringify(doc); //=> "a<p>b</p>"
	 */
	before(...items: Content[]): void {
		let [p, at] = index(read(this));
		state.insert(p, at, contents(p, items));
	}

	/**
	 * Insert nodes or text after this node.
	 * @example
	 * let doc = parse("<p>a</p>");
	 * doc.find("p")?.after("b");
	 * stringify(doc); //=> "<p>a</p>b"
	 */
	after(...items: Content[]): void {
		let [p, at] = index(read(this));
		state.insert(p, at + 1, contents(p, items));
	}

	/**
	 * Replace this node with nodes or text.
	 * @example
	 * let doc = parse("<p><b>x</b></p>");
	 * doc.find("b")?.replace("y");
	 * stringify(doc); //=> "<p>y</p>"
	 */
	replace(...items: Content[]): void {
		let s = read(this);
		let [p, at] = index(s);
		let next = contents(p, items);
		state.insert(p, at, next);
		if (!next.includes(s)) state.detach(s);
	}

	/**
	 * Remove this node from its parent.
	 * @example
	 * let doc = parse("<p>a<b>b</b></p>");
	 * doc.find("b")?.remove();
	 * stringify(doc); //=> "<p>a</p>"
	 */
	remove(): void {
		state.detach(read(this));
	}
}

/**
 * A mutable parsed document. Create one with `parse()`.
 */
export class Document extends Base {
	readonly type: "document" = "document";

	/**
	 * The HTML this document was parsed from. Edits do not change it; use `stringify()`.
	 */
	get source(): string {
		return read(this).source;
	}

	get start(): number {
		return 0;
	}

	get end(): number {
		return read(this).source.length;
	}

	/** Top-level nodes, in order. A new array on every read. */
	get children(): Node[] {
		return read(this).children.map(node);
	}

	/**
	 * The first element that matches a CSS selector list.
	 * @example
	 * parse("<p>a</p>").find("p")?.text; //=> "a"
	 */
	find(selector: string): Element | undefined {
		return find(read(this), selector);
	}

	/**
	 * Every element that matches a CSS selector list, in document order.
	 * @example
	 * parse("<a></a><a></a>").all("a").length; //=> 2
	 */
	all(selector: string): Element[] {
		return all(read(this), selector);
	}

	/**
	 * Convert an offset in `source` to a line and column.
	 * @example
	 * let doc = parse("<p>\n<img>");
	 * doc.position(doc.find("img")?.start ?? 0); //=> { line: 2, column: 1 }
	 */
	position(offset: number): Position {
		let s = read(this);
		let found = LINES.get(s);
		if (!found) LINES.set(s, (found = position.breaks(s.source)));
		return position.locate(found, offset);
	}

	/**
	 * Add nodes or text to the end of the document.
	 * @example
	 * let doc = parse("<p>a</p>");
	 * doc.append("b");
	 * stringify(doc); //=> "<p>a</p>b"
	 */
	append(...items: Content[]): void {
		let s = read(this);
		state.insert(s, s.children.length, contents(s, items));
	}

	/**
	 * Add nodes or text to the start of the document.
	 * @example
	 * let doc = parse("<p>a</p>");
	 * doc.prepend("b");
	 * stringify(doc); //=> "b<p>a</p>"
	 */
	prepend(...items: Content[]): void {
		let s = read(this);
		state.insert(s, 0, contents(s, items));
	}
}

/**
 * A mutable HTML element.
 */
export class Element extends Child {
	readonly type: "element" = "element";

	/**
	 * The tag name. Lowercase, except for case-sensitive SVG names like `clipPath`.
	 * Setting it renames the element, with the same case rules.
	 * @throws {SyntaxError} when set to an invalid tag name.
	 * @throws {TypeError} when set to a void element, like `img`, while there are children.
	 * @example
	 * let doc = parse("<h2>a</h2>");
	 * doc.find("h2")!.name = "H3";
	 * stringify(doc); //=> "<h3>a</h3>"
	 */
	get name(): string {
		return read(this).name;
	}

	set name(input: string) {
		if (!TAG.test(input)) throw new SyntaxError(`Invalid tag name: "${input}"`);
		let name = input.toLowerCase();
		state.rename(read(this), tree.SVG.get(name) ?? name);
	}

	/** Child nodes, in order. A new array on every read. */
	get children(): Node[] {
		return read(this).children.map(node);
	}

	/**
	 * All attributes, with lowercase names and decoded values. Frozen; edits replace it.
	 * @example
	 * parse('<a HREF="/">').find("a")?.attributes; //=> { href: "/" }
	 */
	get attributes(): Readonly<Record<string, string>> {
		return state.attributes(read(this));
	}

	/**
	 * Read one attribute. Names are case-insensitive.
	 * @example
	 * parse('<img alt="x">').find("img")?.getAttr("ALT"); //=> "x"
	 */
	getAttr(name: string): string | undefined {
		let attrs = state.attributes(read(this));
		let key = name.toLowerCase();
		return Object.hasOwn(attrs, key) ? attrs[key] : undefined;
	}

	/**
	 * Whether an attribute is present. Names are case-insensitive.
	 * @example
	 * parse("<input disabled>").find("input")?.hasAttr("disabled"); //=> true
	 */
	hasAttr(name: string): boolean {
		return Object.hasOwn(state.attributes(read(this)), name.toLowerCase());
	}

	/**
	 * Set an attribute. Names are case-insensitive: an existing attribute keeps
	 * its name as written, and a new one is written as given. The value is escaped on output.
	 * @throws {SyntaxError} if `name` is not a valid attribute name.
	 * @example
	 * let doc = parse("<svg>");
	 * doc.find("svg")?.setAttr("viewBox", "0 0 1 1");
	 * doc.find("svg")?.getAttr("viewbox"); //=> "0 0 1 1"
	 * stringify(doc); //=> '<svg viewBox="0 0 1 1">'
	 */
	setAttr(name: string, value: string): void {
		if (!NAME.test(name))
			throw new SyntaxError(`Invalid attribute name: "${name}"`);
		state.setAttribute(read(this), name, value);
	}

	/**
	 * Remove an attribute, if present.
	 * @example
	 * let doc = parse("<input disabled>");
	 * doc.find("input")?.removeAttr("disabled");
	 * stringify(doc); //=> "<input>"
	 */
	removeAttr(name: string): void {
		state.removeAttribute(read(this), name.toLowerCase());
	}

	/**
	 * The decoded text of all descendants. Setting it replaces every child with one text node.
	 * @example
	 * let doc = parse("<p>a <b>b</b></p>");
	 * doc.find("p")!.text = "<c>";
	 * stringify(doc); //=> "<p>&lt;c&gt;</p>"
	 */
	get text(): string {
		return state.text(read(this));
	}

	set text(input: string) {
		let s = read(this);
		state.replaceChildren(s, [state.textNode(state.docOf(s), input)]);
	}

	/**
	 * The inner HTML. Setting it parses the HTML and replaces every child.
	 * @example
	 * let doc = parse("<p>a</p>");
	 * doc.find("p")!.html = "<b>b</b>";
	 * doc.find("p > b")?.text; //=> "b"
	 */
	get html(): string {
		return state.inner(read(this));
	}

	set html(input: string) {
		let s = read(this);
		let doc = state.docOf(s);
		if (tree.RAW.has(s.name)) {
			let raw = values.LITERAL.has(s.name) ? input : decodeHTML(input);
			state.replaceChildren(s, [state.textNode(doc, raw)]);
		} else {
			state.replaceChildren(s, state.fragment(doc, input));
		}
	}

	/**
	 * The first descendant that matches a CSS selector list.
	 * @example
	 * parse("<ul><li>a</li></ul>").find("ul")?.find("li")?.text; //=> "a"
	 */
	find(selector: string): Element | undefined {
		return find(read(this), selector);
	}

	/**
	 * Every descendant that matches a CSS selector list, in document order.
	 * @example
	 * parse("<ul><li></li><li></li></ul>").find("ul")?.all("li").length; //=> 2
	 */
	all(selector: string): Element[] {
		return all(read(this), selector);
	}

	/**
	 * Whether this element matches a CSS selector list.
	 * @example
	 * parse('<a class="x">').find("a")?.matches(".x"); //=> true
	 */
	matches(selector: string): boolean {
		return state.matches(read(this), select.compile(selector));
	}

	/**
	 * The closest ancestor, or this element, that matches a CSS selector list.
	 * @example
	 * parse("<nav><a></a></nav>").find("a")?.closest("nav")?.name; //=> "nav"
	 */
	closest(selector: string): Element | undefined {
		let list = select.compile(selector);
		for (let s: State | undefined = read(this); s; s = s.parent) {
			if (state.matches(s, list)) return element(s);
		}
	}

	/**
	 * A deep copy, with no parent, in the same document. Unedited parts still
	 * serialize as written.
	 * @example
	 * let doc = parse("<ul><li>a</li></ul>");
	 * let li = doc.find("li")?.clone();
	 * if (li) doc.find("ul")?.append(li);
	 * stringify(doc); //=> "<ul><li>a</li><li>a</li></ul>"
	 */
	clone(): Element {
		return copy(Element, this);
	}

	/**
	 * Add nodes or text to the end of this element.
	 * @throws {TypeError} on void elements, like `<img>`.
	 * @example
	 * let doc = parse("<ul></ul>");
	 * doc.find("ul")?.append(...parse("<li>a</li>").children);
	 * stringify(doc); //=> "<ul><li>a</li></ul>"
	 */
	append(...items: Content[]): void {
		let s = read(this);
		state.insert(s, s.children.length, contents(s, items));
	}

	/**
	 * Add nodes or text to the start of this element.
	 * @throws {TypeError} on void elements, like `<img>`.
	 * @example
	 * let doc = parse("<p>b</p>");
	 * doc.find("p")?.prepend("a");
	 * stringify(doc); //=> "<p>ab</p>"
	 */
	prepend(...items: Content[]): void {
		let s = read(this);
		state.insert(s, 0, contents(s, items));
	}
}

/**
 * A mutable run of text.
 */
export class Text extends Child {
	readonly type: "text" = "text";

	/**
	 * The decoded text. It is escaped on output, except inside raw text elements like `<script>`.
	 * @example
	 * let doc = parse("<p>a</p>");
	 * let [node] = doc.find("p")?.children ?? [];
	 * if (node?.type === "text") node.value = "<b>";
	 * stringify(doc); //=> "<p>&lt;b&gt;</p>"
	 */
	get value(): string {
		return state.value(read(this));
	}

	set value(input: string) {
		state.setValue(read(this), input);
	}

	/**
	 * A copy, with no parent, in the same document.
	 * @example
	 * let [node] = parse("a").children;
	 * if (node.type === "text") node.after(node.clone());
	 */
	clone(): Text {
		return copy(Text, this);
	}
}

/**
 * A mutable comment.
 */
export class Comment extends Child {
	readonly type: "comment" = "comment";

	/**
	 * The comment body.
	 * @throws {SyntaxError} when set to a value containing `-->`.
	 * @example
	 * let [node] = parse("<!-- a -->").children;
	 * if (node.type === "comment") node.value = " b ";
	 */
	get value(): string {
		return state.value(read(this));
	}

	set value(input: string) {
		if (input.includes("-->"))
			throw new SyntaxError('A comment cannot contain "-->"');
		state.setValue(read(this), input);
	}

	/**
	 * A copy, with no parent, in the same document.
	 * @example
	 * let [node] = parse("<!--a-->").children;
	 * if (node.type === "comment") node.after(node.clone());
	 */
	clone(): Comment {
		return copy(Comment, this);
	}
}

/**
 * A mutable markup declaration, like `<!doctype html>`.
 */
export class Directive extends Child {
	readonly type: "directive" = "directive";

	/**
	 * The declaration body.
	 * @throws {SyntaxError} when set to a value containing `>`.
	 * @example
	 * let [node] = parse("<!doctype html>").children;
	 * if (node.type === "directive") node.value = "DOCTYPE html";
	 */
	get value(): string {
		return state.value(read(this));
	}

	set value(input: string) {
		if (input.includes(">"))
			throw new SyntaxError('A directive cannot contain ">"');
		state.setValue(read(this), input);
	}

	/**
	 * A copy, with no parent, in the same document.
	 * @example
	 * let [node] = parse("<!doctype html>").children;
	 * if (node.type === "directive") node.after(node.clone());
	 */
	clone(): Directive {
		return copy(Directive, this);
	}
}

/**
 * Wrap a document state in its public view.
 */
export function open(s: State): Document {
	let found = view(s);
	if (found instanceof Document) return found;
	throw new TypeError("Expected a document");
}

/**
 * The state behind a public node.
 */
export function unwrap(target: Node | Document): State {
	return read(target);
}
