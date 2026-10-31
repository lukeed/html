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
	/** The source was parsed as foreign content, like the inside of `<svg>`. */
	foreign: boolean;
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

/** Elements whose children are foreign content. */
export const FOREIGN = new Set(["math", "svg"]);

/** Elements whose children are HTML again, inside foreign content. */
export const INTEGRATION = new Set([
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

/** Case-sensitive SVG tag names, by lowercase name. */
export const SVG = new Map(
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

/** Whether the last tag read by {@link tagEnd} ended with `/>`, outside a value. */
let slash = false;

/**
 * The offset after the `>` that ends a tag, or `-1` when the tag is not
 * closed. Follows the attribute states of htmlparser2: a quote starts a value
 * only after `=`, and an unquoted value ends only at a space or `>`.
 */
function tagEnd(source: string, from: number): number {
	let n = source.length;
	let i = from;
	slash = false;

	while (i < n) {
		let c = source.charCodeAt(i);
		if (c === 32) {
			i++;
			continue;
		}
		if (c === 62) return i + 1;
		if (c === 47) {
			i++;
			while (i < n && isSpace(source.charCodeAt(i))) i++;
			if (source.charCodeAt(i) !== 62) continue;
			slash = true;
			return i + 1;
		}
		if (isSpace(c)) {
			i++;
			continue;
		}

		for (i++; i < n; i++) {
			c = source.charCodeAt(i);
			if (c > 62) continue;
			if (c === 61 || c === 47 || c === 62 || isSpace(c)) break;
		}
		if (c !== 61) {
			while (i < n && isSpace(source.charCodeAt(i))) i++;
			if (source.charCodeAt(i) !== 61) continue;
		}

		c = source.charCodeAt(++i);
		while (i < n && isSpace(c)) c = source.charCodeAt(++i);
		if (c === 34 || c === 39) {
			i = source.indexOf(c === 34 ? '"' : "'", i + 1);
			if (i === -1) return -1;
			i++;
			continue;
		}
		for (; i < n; i++) {
			c = source.charCodeAt(i);
			if (c > 62) continue;
			if (c === 62 || isSpace(c)) break;
		}
	}
	return -1;
}

/**
 * Whether the start tag whose attributes begin at `head` ends with `/>`, outside a value.
 * @example
 * selfClosing("<path d=M0/>", 5); //=> false
 */
export function selfClosing(source: string, head: number): boolean {
	return tagEnd(source, head) !== -1 && slash;
}

/**
 * Where a comment that starts at `from`, after `<!--`, ends: its inner end and
 * its outer end. Like browsers, `<!-->` is empty, `--!>` also closes it, and
 * at the end of the source, trailing dashes are dropped.
 */
function comment(source: string, from: number): [to: number, stop: number] {
	if (source.charCodeAt(from) === 62) return [from, from + 1];
	if (source.startsWith("->", from)) return [from, from + 2];

	for (let at = from; (at = source.indexOf("--", at)) !== -1; at++) {
		let c = source.charCodeAt(at + 2);
		if (c === 62) return [at, at + 3];
		if (c === 33 && source.charCodeAt(at + 3) === 62) return [at, at + 4];
	}

	let n = source.length;
	let to = n;
	while (to > from && to > n - 2 && source.charCodeAt(to - 1) === 45) to--;
	return [to, n];
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
			if (isSpace(next) || next === 62 || next === 47) {
				return at;
			}
		}
		at += 2;
	}
	return source.length;
}

/**
 * Whether the children of node `id` are foreign content, like the inside of `<svg>`.
 */
export function foreign(t: Tree, id: number): boolean {
	for (let x = id; x > 0; x = t.parent[x]) {
		if (FOREIGN.has(t.name[x])) return true;
		if (INTEGRATION.has(t.name[x])) return false;
	}
	return t.foreign;
}

/**
 * Build a {@link Tree} from HTML source, or from foreign content when
 * `foreign` is set, like the inside of `<svg>`.
 * Tree construction follows htmlparser2, not the WHATWG spec.
 */
export function build(source: string, foreign?: boolean): Tree {
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
	let base = foreign === true;
	let alien = base;
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
			alien = contexts.length > 0 ? contexts[contexts.length - 1] : base;
		}
	};

	while (i < n) {
		let lt = source.indexOf("<", i);
		if (lt === -1) break;
		let c = source.charCodeAt(lt + 1);

		if (c === 33) {
			flush(lt);
			if (source.startsWith("--", lt + 2)) {
				let [to, stop] = comment(source, lt + 4);
				add(COMMENT, "", lt, stop, lt + 4, to, lt);
				i = text = stop;
				continue;
			}
			if (alien && source.startsWith("[CDATA[", lt + 2)) {
				let e = source.indexOf("]]>", lt + 9);
				let stop = e === -1 ? n : e + 3;
				add(TEXT, "", lt, stop, lt + 9, e === -1 ? n : e, lt);
				i = text = stop;
				continue;
			}
			let e = source.indexOf(">", lt + 2);
			let stop = e === -1 ? n : e + 1;
			let doctype = source.slice(lt + 2, lt + 9).toLowerCase() === "doctype";
			let type: Kind = doctype ? DIRECTIVE : COMMENT;
			add(type, "", lt, stop, lt + 2, e === -1 ? n : e, lt);
			i = text = stop;
			continue;
		}

		if (c === 63) {
			flush(lt);
			let e = source.indexOf(">", lt + 2);
			let stop = e === -1 ? n : e + 1;
			add(COMMENT, "", lt, stop, lt + 1, e === -1 ? n : e, lt);
			i = text = stop;
			continue;
		}

		if (c === 47) {
			let e = source.indexOf(">", lt + 2);
			if (e === -1) {
				if (lt + 2 >= n) break;
				flush(lt);
				if (!isAlpha(source.charCodeAt(lt + 2))) {
					add(COMMENT, "", lt, n, lt + 2, n, lt);
				}
				i = text = n;
				break;
			}
			flush(lt);
			i = text = e + 1;
			if (e === lt + 2) continue;

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
			if (alien) name = SVG.get(name) ?? name;

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
		if (k === -1) {
			flush(lt);
			i = text = n;
			break;
		}

		flush(lt);
		i = text = k;

		let name = intern(KNOWN, source, lt + 1, j);
		if (alien) name = SVG.get(name) ?? name;
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

		let outer = alien;
		let context =
			flags & IS_FOREIGN ? true : flags & IS_INTEGRATION ? false : undefined;
		if ((context ?? outer) && slash) continue;

		stack.push(id);
		if (context !== undefined) {
			contexts.push(context);
			owners.push(id);
			alien = context;
		}
		if (outer || !(flags & IS_RAW)) continue;

		let close = name === "plaintext" ? n : closing(source, name, k);
		flush(close);
		i = text = close;
	}

	flush(n);
	while (stack.length > 1) pop(n, n);
	stop[0] = size;

	// One buffer for every column of the tree, numbers first, so each is aligned.
	let buffer = new ArrayBuffer(size * 29);
	let copy = (column: Int32Array, index: number): Int32Array => {
		let output = new Int32Array(buffer, index * size * 4, size);
		output.set(column.subarray(0, size));
		return output;
	};
	let kinds = new Uint8Array(buffer, size * 28, size);
	kinds.set(kind.subarray(0, size));

	return {
		source,
		kind: kinds,
		name: names,
		parent: copy(parent, 0),
		stop: copy(stop, 1),
		start: copy(start, 2),
		end: copy(end, 3),
		from: copy(from, 4),
		to: copy(to, 5),
		head: copy(head, 6),
		pairs: new Array(size),
		attrs: new Array(size),
		tags: undefined,
		foreign: base,
	};
}
