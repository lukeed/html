import * as select from "./select";
import * as tree from "./tree";
import * as values from "./values";

import type { Tree } from "./tree";

export type Node = Element | Text | Comment | Directive;
export type Parent = Element | Document;

/** A 1-based source location. */
export type Position = {
	line: number;
	column: number;
};

type Context = {
	tree: Tree;
	nodes: (Node | undefined)[];
	lines: number[] | undefined;
	document: Document;
};

function wrap(ctx: Context, id: number): Node {
	let found = ctx.nodes[id];
	if (found) return found;

	let kind = ctx.tree.kind[id];
	let node =
		kind === tree.ELEMENT
			? new Element(ctx, id)
			: kind === tree.TEXT
				? new Text(ctx, id)
				: kind === tree.COMMENT
					? new Comment(ctx, id)
					: new Directive(ctx, id);

	ctx.nodes[id] = node;
	return node;
}

function element(ctx: Context, id: number): Element {
	let node = wrap(ctx, id);
	if (node instanceof Element) return node;
	throw new TypeError(`Node ${id} is not an element`);
}

function parent(ctx: Context, id: number): Parent {
	let p = ctx.tree.parent[id];
	return p === 0 ? ctx.document : element(ctx, p);
}

function children(ctx: Context, id: number): Node[] {
	let t = ctx.tree;
	let output: Node[] = [];
	for (let x = id + 1; x < t.stop[id]; x = t.stop[x]) output.push(wrap(ctx, x));
	return output;
}

function query(
	ctx: Context,
	id: number,
	selector: string,
): Element | undefined {
	let [found] = select.all(ctx.tree, id, select.compile(selector), 1);
	return found === undefined ? undefined : element(ctx, found);
}

function queryAll(ctx: Context, id: number, selector: string): Element[] {
	return select
		.all(ctx.tree, id, select.compile(selector))
		.map((x) => element(ctx, x));
}

/**
 * The parsed document. Create one with `parse()`.
 */
export class Document {
	readonly type: "document" = "document";
	#ctx: Context;

	/** @internal */
	constructor(t: Tree) {
		this.#ctx = { tree: t, nodes: [], lines: undefined, document: this };
	}

	/**
	 * The HTML source this document was parsed from.
	 * @example
	 * parse("<p>hi</p>").source; //=> "<p>hi</p>"
	 */
	get source(): string {
		return this.#ctx.tree.source;
	}

	get start(): number {
		return 0;
	}

	get end(): number {
		return this.#ctx.tree.source.length;
	}

	/**
	 * Top-level nodes, in source order.
	 * @example
	 * parse("<!doctype html><html></html>").children.length; //=> 2
	 */
	get children(): Node[] {
		return children(this.#ctx, 0);
	}

	/**
	 * The first element that matches a CSS selector list.
	 * @example
	 * parse('<link rel="canonical" href="/">').query("link[rel=canonical]")?.attr("href"); //=> "/"
	 */
	query(selector: string): Element | undefined {
		return query(this.#ctx, 0, selector);
	}

	/**
	 * Every element that matches a CSS selector list, in source order.
	 * @example
	 * parse("<a></a><a></a>").queryAll("a").length; //=> 2
	 */
	queryAll(selector: string): Element[] {
		return queryAll(this.#ctx, 0, selector);
	}

	/**
	 * Convert a source offset, like `element.start`, to a line and column.
	 * @example
	 * let doc = parse("<p>\n<img>");
	 * doc.position(doc.query("img")?.start ?? 0); //=> { line: 2, column: 1 }
	 */
	position(offset: number): Position {
		let ctx = this.#ctx;
		let source = ctx.tree.source;

		if (!ctx.lines) {
			ctx.lines = [];
			for (
				let i = source.indexOf("\n");
				i !== -1;
				i = source.indexOf("\n", i + 1)
			) {
				ctx.lines.push(i);
			}
		}

		let lines = ctx.lines;
		let lo = 0;
		let hi = lines.length;
		while (lo < hi) {
			let mid = (lo + hi) >>> 1;
			if (lines[mid] < offset) lo = mid + 1;
			else hi = mid;
		}

		return {
			line: lo + 1,
			column: offset - (lo > 0 ? lines[lo - 1] + 1 : 0) + 1,
		};
	}
}

/**
 * An HTML element.
 */
export class Element {
	readonly type: "element" = "element";
	#ctx: Context;
	#id: number;

	/** @internal */
	constructor(ctx: Context, id: number) {
		this.#ctx = ctx;
		this.#id = id;
	}

	/**
	 * The tag name. Lowercase, except for case-sensitive SVG names like `clipPath`.
	 * @example
	 * parse("<DIV></DIV>").query("div")?.name; //=> "div"
	 */
	get name(): string {
		return this.#ctx.tree.name[this.#id];
	}

	/** Source offset where the opening tag begins. */
	/** The document this node belongs to. */
	get document(): Document {
		return this.#ctx.document;
	}

	get start(): number {
		return this.#ctx.tree.start[this.#id];
	}

	/** Source offset after the closing tag, or where the element was implicitly closed. */
	get end(): number {
		return this.#ctx.tree.end[this.#id];
	}

	/**
	 * The parent element, or the document for top-level elements.
	 * @example
	 * parse("<ul><li></li></ul>").query("li")?.parent.type; //=> "element"
	 */
	get parent(): Parent {
		return parent(this.#ctx, this.#id);
	}

	/**
	 * Child nodes, in source order.
	 * @example
	 * parse("<p>a<b>b</b></p>").query("p")?.children.length; //=> 2
	 */
	get children(): Node[] {
		return children(this.#ctx, this.#id);
	}

	/**
	 * All attributes, with lowercase names and decoded values. Frozen.
	 * @example
	 * parse('<a HREF="?a=1&amp;b=2">').query("a")?.attributes; //=> { href: "?a=1&b=2" }
	 */
	get attributes(): Readonly<Record<string, string>> {
		return values.attributes(this.#ctx.tree, this.#id);
	}

	/**
	 * Read one attribute. Names are case-insensitive.
	 * @example
	 * parse('<img alt="">').query("img")?.attr("ALT"); //=> ""
	 */
	attr(name: string): string | undefined {
		let attrs = values.attributes(this.#ctx.tree, this.#id);
		let key = name.toLowerCase();
		return Object.hasOwn(attrs, key) ? attrs[key] : undefined;
	}

	/**
	 * Whether an attribute is present. Names are case-insensitive.
	 * @example
	 * parse("<input disabled>").query("input")?.has("disabled"); //=> true
	 */
	has(name: string): boolean {
		return Object.hasOwn(
			values.attributes(this.#ctx.tree, this.#id),
			name.toLowerCase(),
		);
	}

	/**
	 * The decoded text of all descendant text nodes.
	 * @example
	 * parse("<p>a &amp; <b>b</b></p>").query("p")?.text; //=> "a & b"
	 */
	get text(): string {
		return values.text(this.#ctx.tree, this.#id);
	}

	/**
	 * The inner HTML, as written in the source.
	 * @example
	 * parse("<p>a <b>b</b></p>").query("p")?.html; //=> "a <b>b</b>"
	 */
	get html(): string {
		let t = this.#ctx.tree;
		return t.source.slice(t.from[this.#id], t.to[this.#id]);
	}

	/**
	 * The first descendant that matches a CSS selector list.
	 * @example
	 * parse("<ul><li>a</li></ul>").query("ul")?.query("li")?.text; //=> "a"
	 */
	query(selector: string): Element | undefined {
		return query(this.#ctx, this.#id, selector);
	}

	/**
	 * Every descendant that matches a CSS selector list, in source order.
	 * @example
	 * parse("<ul><li></li><li></li></ul>").query("ul")?.queryAll("li").length; //=> 2
	 */
	queryAll(selector: string): Element[] {
		return queryAll(this.#ctx, this.#id, selector);
	}

	/**
	 * Whether this element matches a CSS selector list.
	 * @example
	 * parse('<a class="x">').query("a")?.matches(".x"); //=> true
	 */
	matches(selector: string): boolean {
		return select.matches(this.#ctx.tree, this.#id, select.compile(selector));
	}

	/**
	 * The closest ancestor, or this element, that matches a CSS selector list.
	 * @example
	 * parse("<nav><a></a></nav>").query("a")?.closest("nav")?.name; //=> "nav"
	 */
	closest(selector: string): Element | undefined {
		let t = this.#ctx.tree;
		let list = select.compile(selector);
		for (let id = this.#id; id > 0; id = t.parent[id]) {
			if (select.matches(t, id, list)) return element(this.#ctx, id);
		}
	}
}

/**
 * A run of text.
 */
export class Text {
	readonly type: "text" = "text";
	#ctx: Context;
	#id: number;

	/** @internal */
	constructor(ctx: Context, id: number) {
		this.#ctx = ctx;
		this.#id = id;
	}

	/**
	 * The decoded text. Text in raw text elements, like `<script>`, is not decoded.
	 * @example
	 * let [node] = parse("a &amp; b").children;
	 * if (node.type === "text") node.value; //=> "a & b"
	 */
	get value(): string {
		return values.value(this.#ctx.tree, this.#id);
	}

	/** The document this node belongs to. */
	get document(): Document {
		return this.#ctx.document;
	}

	get start(): number {
		return this.#ctx.tree.start[this.#id];
	}

	get end(): number {
		return this.#ctx.tree.end[this.#id];
	}

	get parent(): Parent {
		return parent(this.#ctx, this.#id);
	}
}

/**
 * A comment, including bogus comments like `<?xml ?>` and `</ 3>`.
 */
export class Comment {
	readonly type: "comment" = "comment";
	#ctx: Context;
	#id: number;

	/** @internal */
	constructor(ctx: Context, id: number) {
		this.#ctx = ctx;
		this.#id = id;
	}

	/**
	 * The comment body, as written.
	 * @example
	 * let [node] = parse("<!-- hi -->").children;
	 * if (node.type === "comment") node.value; //=> " hi "
	 */
	get value(): string {
		return values.value(this.#ctx.tree, this.#id);
	}

	/** The document this node belongs to. */
	get document(): Document {
		return this.#ctx.document;
	}

	get start(): number {
		return this.#ctx.tree.start[this.#id];
	}

	get end(): number {
		return this.#ctx.tree.end[this.#id];
	}

	get parent(): Parent {
		return parent(this.#ctx, this.#id);
	}
}

/**
 * A markup declaration, like `<!doctype html>`.
 */
export class Directive {
	readonly type: "directive" = "directive";
	#ctx: Context;
	#id: number;

	/** @internal */
	constructor(ctx: Context, id: number) {
		this.#ctx = ctx;
		this.#id = id;
	}

	/**
	 * The declaration body, as written.
	 * @example
	 * let [node] = parse("<!doctype html>").children;
	 * if (node.type === "directive") node.value; //=> "doctype html"
	 */
	get value(): string {
		return values.value(this.#ctx.tree, this.#id);
	}

	/** The document this node belongs to. */
	get document(): Document {
		return this.#ctx.document;
	}

	get start(): number {
		return this.#ctx.tree.start[this.#id];
	}

	get end(): number {
		return this.#ctx.tree.end[this.#id];
	}

	get parent(): Parent {
		return parent(this.#ctx, this.#id);
	}
}
