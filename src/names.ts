const COMMON = [
	"a",
	"abbr",
	"address",
	"annotation-xml",
	"area",
	"article",
	"aside",
	"audio",
	"b",
	"base",
	"basefont",
	"blockquote",
	"body",
	"br",
	"button",
	"canvas",
	"caption",
	"circle",
	"cite",
	"code",
	"col",
	"colgroup",
	"command",
	"datalist",
	"dd",
	"defs",
	"desc",
	"details",
	"dialog",
	"div",
	"dl",
	"dt",
	"em",
	"embed",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"foreignobject",
	"form",
	"frame",
	"g",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"head",
	"header",
	"hr",
	"html",
	"i",
	"iframe",
	"image",
	"img",
	"input",
	"isindex",
	"kbd",
	"keygen",
	"label",
	"li",
	"line",
	"link",
	"main",
	"mark",
	"math",
	"meta",
	"mi",
	"mn",
	"mo",
	"ms",
	"mtext",
	"nav",
	"noembed",
	"noframes",
	"noscript",
	"ol",
	"optgroup",
	"option",
	"output",
	"p",
	"param",
	"path",
	"picture",
	"plaintext",
	"polygon",
	"polyline",
	"pre",
	"q",
	"rect",
	"rp",
	"rt",
	"s",
	"samp",
	"script",
	"section",
	"select",
	"small",
	"source",
	"span",
	"strong",
	"style",
	"sub",
	"summary",
	"sup",
	"svg",
	"symbol",
	"table",
	"tbody",
	"td",
	"template",
	"textarea",
	"tfoot",
	"th",
	"thead",
	"time",
	"title",
	"tr",
	"track",
	"u",
	"ul",
	"use",
	"var",
	"video",
	"wbr",
	"xmp",
];

const MASK = 1023;
const TABLE: (string | undefined)[] = new Array(MASK + 1).fill(undefined);

function lower(c: number): number {
	return c >= 65 && c <= 90 ? c + 32 : c;
}

for (let name of COMMON) {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
	let k = h & MASK;
	while (TABLE[k] !== undefined) k = (k + 1) & MASK;
	TABLE[k] = name;
}

function same(source: string, from: number, name: string): boolean {
	for (let i = 0; i < name.length; i++) {
		if (lower(source.charCodeAt(from + i)) !== name.charCodeAt(i)) return false;
	}
	return true;
}

/**
 * The lowercase tag name in `source` from `from` to `to`. Known names
 * return one shared string, so the parser makes no new string, and
 * lookups reuse its cached hash.
 * @example
 * intern("<DIV>", 1, 4); //=> "div"
 */
export function intern(source: string, from: number, to: number): string {
	let h = 0;
	for (let i = from; i < to; i++)
		h = (h * 31 + lower(source.charCodeAt(i))) | 0;

	let length = to - from;
	for (let k = h & MASK; ; k = (k + 1) & MASK) {
		let name = TABLE[k];
		if (name === undefined) return source.slice(from, to).toLowerCase();
		if (name.length === length && same(source, from, name)) return name;
	}
}
