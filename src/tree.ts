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
	kind: Kind[];
	name: string[];
	parent: number[];
	/** First id after this node's subtree. */
	stop: number[];
	/** Outer source range. */
	start: number[];
	end: number[];
	/** Inner range: element content, text value, or comment body. */
	from: number[];
	to: number[];
	/** Where the attribute segment of an element begins. */
	head: number[];
};

const RAW = new Set([
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

const VOID = new Set([
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

const TAG_END = /(?:"[^"]*"|'[^']*'|[^"'>])*>/y;

function isAlpha(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

function isSpace(c: number): boolean {
	return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
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
	let tree: Tree = {
		source,
		kind: [DOCUMENT],
		name: [""],
		parent: [-1],
		stop: [0],
		start: [0],
		end: [n],
		from: [0],
		to: [n],
		head: [0],
	};

	let stack = [0];
	let contexts: boolean[] = [];
	let text = 0;
	let i = 0;

	let add = (
		kind: Kind,
		name: string,
		start: number,
		end: number,
		from: number,
		to: number,
		head: number,
	): number => {
		let id = tree.kind.length;
		tree.kind.push(kind);
		tree.name.push(name);
		tree.parent.push(stack[stack.length - 1]);
		tree.stop.push(id + 1);
		tree.start.push(start);
		tree.end.push(end);
		tree.from.push(from);
		tree.to.push(to);
		tree.head.push(head);
		return id;
	};

	let flush = (to: number): void => {
		if (to > text) add(TEXT, "", text, to, text, to, text);
	};

	let pop = (at: number, inner: number): void => {
		let id = stack.pop()!;
		tree.end[id] = at;
		tree.to[id] = inner;
		tree.stop[id] = tree.kind.length;
		let name = tree.name[id];
		if (FOREIGN.has(name) || INTEGRATION.has(name)) contexts.pop();
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
			let name = source.slice(lt + 2, j).toLowerCase();
			if (contexts.at(-1)) name = SVG.get(name) ?? name;

			if (VOID.has(name)) {
				if (name === "br") add(ELEMENT, "br", lt, e + 1, e + 1, e + 1, e);
				continue;
			}

			let pos = stack.length - 1;
			while (pos > 0 && tree.name[stack[pos]] !== name) pos--;

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

		TAG_END.lastIndex = j;
		if (!TAG_END.test(source)) break;
		let k = TAG_END.lastIndex;

		flush(lt);
		i = text = k;

		let name = source.slice(lt + 1, j);
		let lower = name.toLowerCase();
		if (contexts.at(-1)) name = SVG.get(lower) ?? lower;
		else name = lower === "image" ? "img" : lower;

		if (name === "form" && stack.some((x) => tree.name[x] === "form")) continue;

		let implies = IMPLIES.get(name);
		if (implies) {
			while (
				stack.length > 1 &&
				implies.has(tree.name[stack[stack.length - 1]])
			) {
				pop(lt, lt);
			}
		}

		let id = add(ELEMENT, name, lt, k, k, k, j);
		if (VOID.has(name)) continue;

		let outer = contexts.at(-1) ?? false;
		let context = FOREIGN.has(name)
			? true
			: INTEGRATION.has(name)
				? false
				: undefined;
		let foreign = context ?? outer;
		if (foreign && source.charCodeAt(k - 2) === 47) continue;

		stack.push(id);
		if (context !== undefined) contexts.push(context);
		if (outer || !RAW.has(name)) continue;

		let close = name === "plaintext" ? n : closing(source, name, k);
		flush(close);
		i = text = close;
	}

	flush(n);
	while (stack.length > 1) pop(n, n);
	tree.stop[0] = tree.kind.length;

	return tree;
}
