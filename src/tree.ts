import { intern, table } from "./names";

export const DOCUMENT = 0;
export const ELEMENT = 1;
export const TEXT = 2;
export const COMMENT = 3;
export const DIRECTIVE = 4;

export type Kind =
	| typeof DOCUMENT
	| typeof ELEMENT
	| typeof TEXT
	| typeof COMMENT
	| typeof DIRECTIVE;

/**
 * The parsed document as parallel arrays, indexed by node id.
 * Node 0 is the document; ids follow source order.
 */
export type Tree = {
	source: string;
	/** A {@link Kind} per node. */
	kind: Uint8Array;
	name: string[];
	parent: Int32Array;
	/** First id after this node's subtree. */
	stop: Int32Array;
	/** Outer source range. */
	start: Int32Array;
	end: Int32Array;
	/** Inner range: element content, text value, or comment body. */
	from: Int32Array;
	to: Int32Array;
	/** Where the attribute segment of an element begins. */
	head: Int32Array;
	/** Parsed attributes as `[name, value, ...]`, filled on first read. */
	pairs: (string[] | undefined)[];
	/** Frozen attribute records, filled on first read of `attributes`. */
	attrs: (Readonly<Record<string, string>> | undefined)[];
	/** Element ids by tag name, built on first query. */
	tags: Map<string, number[]> | undefined;
};

export const RAW = new Set([
	"script",
	"style",
	"textarea",
	"title",
	"xmp",
	"iframe",
	"noembed",
	"noframes",
	"plaintext",
]);

export const VOID = new Set([
	"area",
	"base",
	"basefont",
	"br",
	"col",
	"command",
	"embed",
	"frame",
	"hr",
	"img",
	"input",
	"isindex",
	"keygen",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

const FOREIGN = new Set(["math", "svg"]);

const INTEGRATION = new Set([
	"mi",
	"mo",
	"mn",
	"ms",
	"mtext",
	"annotation-xml",
	"foreignObject",
	"desc",
	"title",
]);

const SVG = new Map(
	[
		"altGlyph",
		"altGlyphDef",
		"altGlyphItem",
		"animateColor",
		"animateMotion",
		"animateTransform",
		"clipPath",
		"feBlend",
		"feColorMatrix",
		"feComponentTransfer",
		"feComposite",
		"feConvolveMatrix",
		"feDiffuseLighting",
		"feDisplacementMap",
		"feDistantLight",
		"feDropShadow",
		"feFlood",
		"feFuncA",
		"feFuncB",
		"feFuncG",
		"feFuncR",
		"feGaussianBlur",
		"feImage",
		"feMerge",
		"feMergeNode",
		"feMorphology",
		"feOffset",
		"fePointLight",
		"feSpecularLighting",
		"feSpotLight",
		"feTile",
		"feTurbulence",
		"foreignObject",
		"glyphRef",
		"linearGradient",
		"radialGradient",
		"textPath",
	].map((x) => [x.toLowerCase(), x]),
);

const P = new Set(["p"]);
const HEADING = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p"]);
const FORM = new Set([
	"input",
	"option",
	"optgroup",
	"select",
	"button",
	"datalist",
	"textarea",
]);
const DDT = new Set(["dd", "dt"]);
const RTP = new Set(["rt", "rp"]);
const SECTION = new Set(["thead", "tbody"]);

const IMPLIES = new Map<string, Set<string>>([
	["tr", new Set(["tr", "th", "td"])],
	["th", new Set(["th"])],
	["td", new Set(["thead", "th", "td"])],
	["body", new Set(["head", "link", "script"])],
	["a", new Set(["a"])],
	["li", new Set(["li"])],
	["p", P],
	["h1", HEADING],
	["h2", HEADING],
	["h3", HEADING],
	["h4", HEADING],
	["h5", HEADING],
	["h6", HEADING],
	["select", FORM],
	["input", FORM],
	["output", FORM],
	["button", FORM],
	["datalist", FORM],
	["textarea", FORM],
	["option", new Set(["option"])],
	["optgroup", new Set(["optgroup", "option"])],
	["dd", DDT],
	["dt", DDT],
	["rt", RTP],
	["rp", RTP],
	["tbody", SECTION],
	["tfoot", SECTION],
	...[
		"address",
		"article",
		"aside",
		"blockquote",
		"details",
		"div",
		"dl",
		"fieldset",
		"figcaption",
		"figure",
		"footer",
		"form",
		"header",
		"hr",
		"main",
		"nav",
		"ol",
		"pre",
		"section",
		"table",
		"ul",
	].map((x): [string, Set<string>] => [x, P]),
]);

/** Every name the parser checks, and other common tags. */
const KNOWN = table([
	...RAW,
	...VOID,
	...FOREIGN,
	...[...INTEGRATION].map((x) => x.toLowerCase()),
	...IMPLIES.keys(),
	..."html head span i b em strong small code label picture noscript template time sup path g use rect circle image video".split(
		" ",
	),
]);

const IS_VOID = 1;
const IS_RAW = 2;
const IS_FOREIGN = 4;
const IS_INTEGRATION = 8;
const HAS_IMPLIES = 16;

/** The {@link VOID}, {@link RAW}, foreign, and implied-end sets of each name, as bits. */
const FLAGS = new Map<string, number>();
for (let [names, flag] of [
	[VOID, IS_VOID],
	[RAW, IS_RAW],
	[FOREIGN, IS_FOREIGN],
	[INTEGRATION, IS_INTEGRATION],
	[IMPLIES.keys(), HAS_IMPLIES],
] as const) {
	for (let name of names) FLAGS.set(name, (FLAGS.get(name) ?? 0) | flag);
}

function isAlpha(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

function isSpace(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

/**
 * The offset after the `>` that ends a tag, skipping quoted values, or `-1`
 * when the tag is not closed.
 */
function tagEnd(source: string, from: number): number {
	let n = source.length;
	for (let i = from; i < n; i++) {
		let c = source.charCodeAt(i);
		if (c === 62) return i + 1;
		if (c === 34 || c === 39) {
			i = source.indexOf(c === 34 ? '"' : "'", i + 1);
			if (i === -1) return -1;
		}
	}
	return -1;
}

function grow<T extends Uint8Array | Int32Array>(column: T, size: number): T {
	let next = new (column.constructor as new (size: number) => T)(size);
	next.set(column);
	return next;
}

/**
 * Find the `</name` that closes a raw text element, ignoring case.
 */
function closing(source: string, name: string, from: number): number {
	let at = from;
	while ((at = source.indexOf("</", at)) !== -1) {
		let tail = at + 2 + name.length;
		if (source.slice(at + 2, tail).toLowerCase() === name) {
			let next = source.charCodeAt(tail);
			if (Number.isNaN(next) || isSpace(next) || next === 62 || next === 47) {
				return at;
			}
		}
		at += 2;
	}
	return source.length;
}

/**
 * Build a {@link Tree} from HTML source.
 * Tree construction follows htmlparser2, not the WHATWG spec.
 */
export function build(source: string): Tree {
	let n = source.length;
	let size = 1;
	let capacity = Math.max(64, n >> 4);
	let kind = new Uint8Array(capacity);
	let names: string[] = [""];
	let parent = new Int32Array(capacity);
	let stop = new Int32Array(capacity);
	let start = new Int32Array(capacity);
	let end = new Int32Array(capacity);
	let from = new Int32Array(capacity);
	let to = new Int32Array(capacity);
	let head = new Int32Array(capacity);
	parent[0] = -1;
	end[0] = to[0] = n;

	let stack = [0];
	let contexts: boolean[] = [];
	let owners: number[] = [];
	let text = 0;
	let i = 0;

	let add = (
		type: Kind,
		tag: string,
		outer: number,
		close: number,
		inner: number,
		until: number,
		attrs: number,
	): number => {
		if (size === capacity) {
			capacity *= 2;
			kind = grow(kind, capacity);
			parent = grow(parent, capacity);
			stop = grow(stop, capacity);
			start = grow(start, capacity);
			end = grow(end, capacity);
			from = grow(from, capacity);
			to = grow(to, capacity);
			head = grow(head, capacity);
		}
		let id = size++;
		kind[id] = type;
		names.push(tag);
		parent[id] = stack[stack.length - 1];
		stop[id] = id + 1;
		start[id] = outer;
		end[id] = close;
		from[id] = inner;
		to[id] = until;
		head[id] = attrs;
		return id;
	};

	let flush = (to: number): void => {
		if (to > text) add(TEXT, "", text, to, text, to, text);
	};

	let pop = (at: number, inner: number): void => {
		let id = stack.pop()!;
		end[id] = at;
		to[id] = inner;
		stop[id] = size;
		if (owners.length > 0 && owners[owners.length - 1] === id) {
			owners.pop();
			contexts.pop();
		}
	};

	while (i < n) {
		let lt = source.indexOf("<", i);
		if (lt === -1) break;
		let c = source.charCodeAt(lt + 1);

		if (c === 33) {
			flush(lt);
			if (source.startsWith("--", lt + 2)) {
				let e = source.indexOf("-->", lt + 4);
				let stop = e === -1 ? n : e + 3;
				add(COMMENT, "", lt, stop, lt + 4, e === -1 ? n : e, lt);
				i = text = stop;
			} else {
				let e = source.indexOf(">", lt + 2);
				let stop = e === -1 ? n : e + 1;
				add(DIRECTIVE, "", lt, stop, lt + 2, e === -1 ? n : e, lt);
				i = text = stop;
			}
			continue;
		}

		if (c === 63) {
			flush(lt);
			let e = source.indexOf(">", lt + 2);
			let stop = e === -1 ? n : e + 1;
			add(COMMENT, "", lt, stop, lt + 2, e === -1 ? n : e, lt);
			i = text = stop;
			continue;
		}

		if (c === 47) {
			let e = source.indexOf(">", lt + 2);
			if (e === -1) break;
			flush(lt);
			i = text = e + 1;

			if (!isAlpha(source.charCodeAt(lt + 2))) {
				add(COMMENT, "", lt, e + 1, lt + 2, e, lt);
				continue;
			}

			let j = lt + 2;
			while (
				j < e &&
				!isSpace(source.charCodeAt(j)) &&
				source.charCodeAt(j) !== 47
			)
				j++;
			let name = intern(KNOWN, source, lt + 2, j);
			if (contexts.at(-1)) name = SVG.get(name) ?? name;

			if ((FLAGS.get(name) ?? 0) & IS_VOID) {
				if (name === "br") add(ELEMENT, "br", lt, e + 1, e + 1, e + 1, e);
				continue;
			}

			let pos = stack.length - 1;
			while (pos > 0 && names[stack[pos]] !== name) pos--;

			if (pos > 0) {
				while (stack.length - 1 > pos) pop(lt, lt);
				pop(e + 1, lt);
			} else if (name === "p") {
				add(ELEMENT, "p", lt, e + 1, e + 1, e + 1, e);
			}
			continue;
		}

		if (!isAlpha(c)) {
			i = lt + 1;
			continue;
		}

		let j = lt + 2;
		while (j < n) {
			let ch = source.charCodeAt(j);
			if (isSpace(ch) || ch === 62 || ch === 47) break;
			j++;
		}

		let k = tagEnd(source, j);
		if (k === -1) break;

		flush(lt);
		i = text = k;

		let name = intern(KNOWN, source, lt + 1, j);
		if (contexts.at(-1)) name = SVG.get(name) ?? name;
		else if (name === "image") name = "img";

		if (name === "form" && stack.some((x) => names[x] === "form")) continue;

		let flags = FLAGS.get(name) ?? 0;
		if (flags & HAS_IMPLIES) {
			let implies = IMPLIES.get(name)!;
			while (stack.length > 1 && implies.has(names[stack[stack.length - 1]])) {
				pop(lt, lt);
			}
		}

		let id = add(ELEMENT, name, lt, k, k, k, j);
		if (flags & IS_VOID) continue;

		let outer = contexts.at(-1) ?? false;
		let context =
			flags & IS_FOREIGN ? true : flags & IS_INTEGRATION ? false : undefined;
		let foreign = context ?? outer;
		if (foreign && source.charCodeAt(k - 2) === 47) continue;

		stack.push(id);
		if (context !== undefined) {
			contexts.push(context);
			owners.push(id);
		}
		if (outer || !(flags & IS_RAW)) continue;

		let close = name === "plaintext" ? n : closing(source, name, k);
		flush(close);
		i = text = close;
	}

	flush(n);
	while (stack.length > 1) pop(n, n);
	stop[0] = size;

	return {
		source,
		kind: kind.slice(0, size),
		name: names,
		parent: parent.slice(0, size),
		stop: stop.slice(0, size),
		start: start.slice(0, size),
		end: end.slice(0, size),
		from: from.slice(0, size),
		to: to.slice(0, size),
		head: head.slice(0, size),
		pairs: new Array(size),
		attrs: new Array(size),
		tags: undefined,
	};
}
