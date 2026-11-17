import { describe, expect, test } from "bun:test";

import * as html from "../index";
import * as mutable from "./index";
import { unwrap } from "./node";

import type { Document, Element, Node } from "./index";
import type { State } from "./state";

const SOURCE = `<!doctype html>
<html>
<head>
	<title>Hi &amp; bye</title>
	<link rel="canonical" href="https://example.com/?a=1&amp;b=2">
</head>
<body class=page>
	<!-- note -->
	<nav><a href="/" CLASS=x>Home</a><a href="/about/">About</a><b>bold</nav>
	<p>One <b>two</b> &lt;three&gt;<p>implied</b>
	<ul><li>1<li>2<li class=x>3</ul>
	<template><p class=x>hidden</p><li>t</li></template>
	<table><tr><td>a<td>b</table>
	<img src=a.png><input disabled>
	<svg viewBox="0 0 1 1"><clipPath id=c><rect/></clipPath><foreignObject><p>in</p></foreignObject></svg>
	<div><div><span>deep <i>er</i></span></div><em>x</em></div>
	<script>if (a < b) "&amp;"</script>
	<textarea>a &amp; b</textarea>
	<p><a href=#>a<p>b</a>
</body>
</html>`;

const SOURCES = [
	SOURCE,
	"",
	"text &amp; more",
	"<p>a<p>b",
	"<a href=x/>",
	"<!--x",
	"<svg><path/></svg>",
	"<div><b>x</div></b>y",
	"<ul><li>1<li>2</ul><ol><li>3</li></ol>",
	"<p><b><i>x</b>y</i>z</p>",
	"<table><td>a</table><select><option>1<option>2</select>",
];

const SELECTORS = [
	"*",
	"a",
	"p",
	"li",
	"nav > a + a",
	"nav a ~ b",
	"head title",
	"body p",
	".x",
	"a.x",
	"[href]",
	"p:first-of-type",
	"li:nth-child(2)",
	"li:last-child",
	":root",
	":root > body",
	"img:not([alt])",
	":empty",
	"div div span i",
	"div > em",
	"clipPath",
	"svg rect",
	"td + td",
	":is(li, td):only-of-type",
	"section p, aside, ul > li",
	"[data-x] i",
	"[constructor]",
];

/**
 * The number of states made below and including `s`.
 */
function made(s: State): number {
	let count = 1;
	for (let child of s.children ?? []) count += made(child);
	return count;
}

/** Read every child list, so that every state exists. */
function force(node: Node | Document): void {
	if (node.type === "document" || node.type === "element")
		for (let child of node.children) force(child);
}

/** The tree as nested names and text. */
function shape(node: Node | Document): string {
	if (node.type === "text") return JSON.stringify(node.value);
	if (node.type !== "element" && node.type !== "document") return node.type;
	let name = node.type === "element" ? node.name : "#document";
	return `${name}(${node.children.map(shape).join(",")})`;
}

/** What a query found, comparable across documents. */
function found(list: Element[]): string[] {
	return list.map((x) => `${x.start}:${x.name}:${mutable.stringify(x)}`);
}

/** A seeded pseudo-random generator, so that failures replay. */
function random(seed: number): (n: number) => number {
	let x = seed >>> 0 || 1;
	return (n) => {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		return (x >>> 0) % n;
	};
}

/** Run `fn`, returning the error message or the result. */
function attempt(fn: () => unknown): unknown {
	try {
		return fn();
	} catch (error) {
		return `throws ${(error as Error).constructor.name}: ${(error as Error).message}`;
	}
}

/**
 * Apply one random edit to `doc`, picking nodes by index, so the same call
 * on two equal documents makes the same edit. `other` is a document to move
 * or copy nodes from.
 */
function edit(doc: Document, other: Document, pick: (n: number) => number) {
	let elements = doc.all("*");
	let el = elements[pick(elements.length || 1)];
	let theirs = other.all("*");
	let foreign = theirs[pick(theirs.length || 1)];
	let op = pick(14);
	if (!el) return attempt(() => doc.append("tail"));
	switch (op) {
		case 0:
			return attempt(() => el.setAttr(pick(2) ? "data-x" : "Data-New", 'v&"'));
		case 1:
			return attempt(() => el.removeAttr(pick(2) ? "class" : "href"));
		case 2:
			return attempt(() => {
				el.name = ["section", "b", "li", "img", "script", "p"][pick(6)];
			});
		case 3:
			return attempt(() => {
				el.text = "t<&>";
			});
		case 4:
			return attempt(() => {
				el.html = "<i>x</i><p>y";
			});
		case 5:
			return attempt(() => el.remove());
		case 6:
			return attempt(() => {
				let target = elements[pick(elements.length)];
				target.append(el);
			});
		case 7:
			return attempt(() => {
				let target = elements[pick(elements.length)];
				target.before(el.clone());
			});
		case 8:
			return attempt(() => el.after(foreign ?? "x"));
		case 9:
			return attempt(() => el.prepend(foreign?.clone() ?? "y"));
		case 10:
			return attempt(() => {
				let [first] = el.children;
				if (first) el.append(first);
			});
		case 11:
			return attempt(() => {
				let kids = el.children;
				if (kids.length) kids[pick(kids.length)].replace("r", kids[0]);
			});
		case 12:
			return attempt(() => {
				for (let child of el.children)
					if (child.type === "text") child.value = "<v>";
			});
		default:
			return attempt(() => el.parent?.prepend(el));
	}
}

describe("queries on clean hydrated subtrees", () => {
	test("preserve identity and source order without marking reads dirty", () => {
		let source =
			"<main><ul><li class=x>A</li><li>B</li></ul><template><li class=x>hidden</li></template><ul><li>C</li></ul></main>";
		let doc = mutable.parse(source);
		force(doc);
		let elements = doc.all("*");
		let immutable = html.parse(source);
		for (let round = 0; round < 2; round++) {
			for (let selector of [
				"*",
				".x",
				"li:nth-child(2)",
				"li + li",
				"li:only-child",
				"ul > li:first-child",
				"template li",
			]) {
				let expected = immutable.all(selector).map((x) => x.start);
				let actual = doc.all(selector);
				expect(actual.map((x) => x.start)).toEqual(expected);
				for (let el of actual)
					expect(el).toBe(elements.find((x) => x.start === el.start)!);
				expect(doc.find(selector)).toBe(actual[0]);
			}
			for (let el of elements) expect(unwrap(el).dirty).toBe(false);
			expect(unwrap(doc).dirty).toBe(false);
		}
		expect(mutable.stringify(doc)).toBe(source);
	});

	test("clean scans see edits outside their scope and fall back after internal edits", () => {
		let doc = mutable.parse(
			"<main><header>H</header><section><p class=x>A</p><p>B</p></section></main>",
		);
		force(doc);
		let main = doc.find("main")!;
		let section = doc.find("section")!;
		let first = section.find("p")!;
		doc.find("header")!.name = "h1";
		main.setAttr("class", "edited");
		expect(unwrap(doc).dirty).toBe(true);
		expect(unwrap(section).dirty).toBe(false);
		for (let root of [doc, section]) {
			expect(root.all(".edited > h1 + section > p:first-child")).toEqual([
				first,
			]);
			expect(root.all("header + section p")).toEqual([]);
		}
		first.removeAttr("class");
		first.name = "span";
		expect(unwrap(section).dirty).toBe(true);
		for (let round = 0; round < 2; round++) {
			expect(section.all("p").map((x) => x.text)).toEqual(["B"]);
			expect(doc.all("section > span")).toEqual([first]);
			expect(section.all(".x")).toEqual([]);
			mutable.stringify(doc);
			expect(unwrap(section).dirty).toBe(true);
		}
	});

	test("clean descendants see reordered and removed siblings", () => {
		let doc = mutable.parse(
			"<ul><li><b>A</b></li><li><b>B</b></li><li><b>C</b></li></ul>",
		);
		force(doc);
		let ul = doc.find("ul")!;
		let [a, b, c] = ul.all("li");
		let bold = b.find("b")!;
		ul.prepend(c);
		a.remove();
		expect(unwrap(ul).dirty).toBe(true);
		expect(unwrap(b).dirty).toBe(false);
		for (let round = 0; round < 2; round++) {
			expect(doc.all("li:nth-child(2) > b")).toEqual([bold]);
			expect(b.all("li:first-child + li > b")).toEqual([bold]);
			expect(doc.all("li:first-child b").map((x) => x.text)).toEqual(["C"]);
			expect(doc.all("b").map((x) => x.text)).toEqual(["C", "B"]);
		}
	});

	test("hydrated clones and adopted subtrees keep separate identities and current ancestors", () => {
		let from = mutable.parse(
			"<article><section><ul><li class=a>A</li><li>B</li></ul></section></article>",
		);
		force(from);
		let original = from.find("section")!;
		let first = original.find("li")!;
		let copy = original.clone();
		let copied = copy.find("li")!;
		expect(copied).not.toBe(first);
		expect(copy.find("article li")).toBeUndefined();
		let to = mutable.parse("<main><aside></aside><nav></nav></main>");
		force(to);
		to.find("aside")!.append(copy);
		to.find("nav")!.append(original);
		expect(unwrap(copy).dirty).toBe(false);
		expect(unwrap(original).dirty).toBe(false);
		for (let round = 0; round < 2; round++) {
			expect(to.find("aside section li:first-child")).toBe(copied);
			expect(to.find("nav section li:first-child")).toBe(first);
			expect(copy.find("main > aside li")).toBe(copied);
			expect(to.all("li").map((x) => x.text)).toEqual(["A", "B", "A", "B"]);
			expect(from.all("li")).toEqual([]);
			expect(copied.document).toBe(to);
			expect(first.document).toBe(to);
		}
		copied.setAttr("class", "b");
		expect(to.all(".b")).toEqual([copied]);
		expect(to.all(".a")).toEqual([first]);
		expect(unwrap(copy).dirty).toBe(true);
		expect(unwrap(original).dirty).toBe(false);
	});

	test("failed mutations leave hydrated clean scans valid", () => {
		let doc = mutable.parse("<div><p><b>A</b></p></div>");
		force(doc);
		let div = doc.find("div")!;
		let p = doc.find("p")!;
		let b = doc.find("b")!;
		expect(() => p.append(div)).toThrow(TypeError);
		expect(() => {
			p.name = "img";
		}).toThrow(TypeError);
		expect(unwrap(doc).dirty).toBe(false);
		expect(doc.find("div > p > b")).toBe(b);
		expect(p.all("b")).toEqual([b]);
	});
});

describe("lazy states", () => {
	test("parse makes only the document state", () => {
		let doc = mutable.parse(SOURCE);
		expect(made(unwrap(doc))).toBe(1);
		expect(mutable.stringify(doc)).toBe(SOURCE);
		expect(doc.text).toBe(html.parse(SOURCE).text);
		expect(made(unwrap(doc))).toBe(1);
		expect(doc.find("ul")?.html).toBe("<li>1<li>2<li class=x>3");
	});

	test("reading children makes one level", () => {
		let doc = mutable.parse("<div><p><b>x</b></p><i></i></div>y");
		let [div, text] = doc.children;
		expect(text.type).toBe("text");
		expect(made(unwrap(doc))).toBe(3);
		expect(div.type === "element" && div.children.length).toBe(2);
		expect(made(unwrap(doc))).toBe(5);
	});

	test("queries make only matches, their ancestors, and their siblings", () => {
		let doc = mutable.parse(
			"<div><p>a</p><p>b<span>c</span></p></div><div><p>d</p></div>",
		);
		let span = doc.find("span");
		expect(span?.text).toBe("c");
		// document, both divs, both p, and the span and its sibling text.
		expect(made(unwrap(doc))).toBe(7);
		let up = span?.parent;
		let top = up?.type === "element" ? up.parent : undefined;
		expect(top?.type === "element" && top.parent).toBe(doc);
	});

	test("states keep their identity however they are reached", () => {
		let doc = mutable.parse(SOURCE);
		let b = doc.find("p b");
		let p = doc.find("p");
		expect(b?.parent).toBe(p);
		expect(p?.children[1]).toBe(b!);
		expect(doc.find("p b")).toBe(b);
		expect(doc.all("b")[1]).toBe(b!);
		let body = doc.find("body")!;
		expect(body.children.includes(p!)).toBe(true);
		expect(doc.find("html")?.children.includes(body)).toBe(true);
		expect(doc.find("i")?.closest("div > div")).toBe(doc.all("div")[1]);
		for (let el of doc.all("*")) {
			let up = el.parent;
			expect(up?.children.includes(el)).toBe(true);
			expect(doc.all("*").includes(el)).toBe(true);
		}
	});

	test("queries agree with the immutable parser and with full states", () => {
		for (let source of SOURCES) {
			let eager = mutable.parse(source);
			force(eager);
			let tree = html.parse(source);
			for (let selector of SELECTORS) {
				let expected = tree.all(selector).map((x) => x.start);
				let lazy = mutable.parse(source);
				expect(lazy.all(selector).map((x) => x.start)).toEqual(expected);
				expect(eager.all(selector).map((x) => x.start)).toEqual(expected);
				expect(lazy.find(selector)?.start).toBe(expected[0]);
				let fresh = mutable.parse(source);
				expect(fresh.find(selector)?.start).toBe(expected[0]);
			}
		}
	});

	test("element queries look up through edited ancestors", () => {
		let doc = mutable.parse(
			"<main><div class=a><p><i>x</i></p></div><div><p><i>y</i></p></div></main>",
		);
		let [first, second] = doc.find("main")!.children as Element[];
		first.name = "section";
		second.setAttr("data-x", "");
		expect(doc.all("section i").map((x) => x.text)).toEqual(["x"]);
		expect(doc.all("div i").map((x) => x.text)).toEqual(["y"]);
		expect(doc.all("[data-x] i").map((x) => x.text)).toEqual(["y"]);
		expect(doc.all(".a i").map((x) => x.text)).toEqual(["x"]);
		first.removeAttr("class");
		expect(doc.all(".a i")).toEqual([]);
		expect(first.all("main section > p > i").map((x) => x.text)).toEqual(["x"]);
		expect(doc.find("i")?.matches("section p i")).toBe(true);
	});

	test("structural selectors see moved and removed siblings", () => {
		let doc = mutable.parse(
			"<ul><li><b>1</b><li><b>2</b><li><b>3</b></ul><ol><li><b>4</b></ol>",
		);
		let ul = doc.find("ul")!;
		expect(doc.all("li:first-child b").map((x) => x.text)).toEqual(["1", "4"]);
		ul.children[0].remove();
		expect(doc.all("li:first-child b").map((x) => x.text)).toEqual(["2", "4"]);
		expect(doc.all("li:nth-child(2) > b").map((x) => x.text)).toEqual(["3"]);
		expect(doc.all("li + li b").map((x) => x.text)).toEqual(["3"]);
		doc.find("ol")!.prepend(doc.find("li")!);
		expect(doc.all("li:first-child b").map((x) => x.text)).toEqual(["3", "2"]);
		expect(doc.all("li:only-child b").map((x) => x.text)).toEqual(["3"]);
		expect(doc.all("li ~ li b").map((x) => x.text)).toEqual(["4"]);
		expect(mutable.stringify(doc)).toBe(
			"<ul><li><b>3</b></ul><ol><li><b>2</b></li><li><b>4</b></ol>",
		);
	});

	test(":root and :empty on states and unread nodes", () => {
		let doc = mutable.parse("<p></p><div><p></p><p>x</p></div>");
		expect(found(doc.all(":root"))).toEqual([
			"0:p:<p></p>",
			"7:div:<div><p></p><p>x</p></div>",
		]);
		expect(doc.all("p:empty").map((x) => x.start)).toEqual([0, 12]);
		let div = doc.find("div")!;
		expect(div.matches(":root")).toBe(true);
		let fresh = mutable.parse("<p></p><div><p></p></div>");
		expect(fresh.find("div")?.matches(":empty")).toBe(false);
		expect(fresh.find("p")?.matches(":empty")).toBe(true);
	});

	test("template contents are skipped below the root, read or not", () => {
		let source =
			'<template><p class="x">a<template><p class=x>b</p></template></p></template><p class="x">c</p>';
		for (let read of [false, true]) {
			let doc = mutable.parse(source);
			if (read) force(doc);
			expect(doc.all(".x").map((x) => x.text)).toEqual(["c"]);
			let template = doc.find("template")!;
			expect(template.all(".x").map((x) => x.text)).toEqual(["ab"]);
			expect(template.all("p").length).toBe(1);
			expect(template.all("*").length).toBe(2);
		}
	});

	test("text reads unread subtrees and edits", () => {
		let doc = mutable.parse(
			"<p>a &amp; <b>b</b><!-- c --></p><script>&amp;</script>",
		);
		expect(doc.text).toBe("a & b&amp;");
		let p = doc.find("p")!;
		expect(made(unwrap(doc))).toBeLessThan(5);
		expect(p.text).toBe("a & b");
		doc.find("b")!.text = "B";
		expect(doc.text).toBe("a & B&amp;");
	});

	test("moving an unread subtree to another document adopts it", () => {
		let from = mutable.parse("<div><p><b>x</b></p></div>");
		let to = mutable.parse("<main></main>");
		let div = from.find("div")!;
		to.find("main")!.append(div);
		expect(div.document).toBe(to);
		let b = div.find("b")!;
		expect(b.document).toBe(to);
		expect(b.parent?.type === "element" && b.parent.document).toBe(to);
		expect(b.start).toBeUndefined();
		expect(mutable.stringify(to)).toBe(
			"<main><div><p><b>x</b></p></div></main>",
		);
		expect(mutable.stringify(from)).toBe("");
		expect(to.find("main b")).toBe(b);
		expect(from.find("b")).toBeUndefined();
	});

	test("adoption reaches states read before and after a move", () => {
		let from = mutable.parse("<div><p><b>x</b><i>y</i></p></div>");
		let to = mutable.parse("<main></main>");
		let b = from.find("b")!;
		let div = from.find("div")!;
		to.find("main")!.append(div);
		expect(b.document).toBe(to);
		expect(div.find("i")?.document).toBe(to);
		let back = mutable.parse("");
		back.append(div);
		expect(b.document).toBe(back);
		expect(div.find("i")?.document).toBe(back);
	});

	test("clones of unread subtrees are separate and serialize as written", () => {
		let doc = mutable.parse("<ul><li class=a>1 <b>x</b><li>2</ul>");
		let ul = doc.find("ul")!;
		let copy = ul.clone();
		expect(mutable.stringify(copy)).toBe(
			"<ul><li class=a>1 <b>x</b><li>2</ul>",
		);
		let b = copy.find("b")!;
		expect(b).not.toBe(doc.find("b")!);
		expect(b.closest("ul")).toBe(copy);
		b.text = "y";
		expect(mutable.stringify(copy)).toBe(
			"<ul><li class=a>1 <b>y</b><li>2</ul>",
		);
		expect(mutable.stringify(doc)).toBe("<ul><li class=a>1 <b>x</b><li>2</ul>");
		doc.find("b")!.setAttr("id", "z");
		expect(mutable.stringify(copy)).toBe(
			"<ul><li class=a>1 <b>y</b><li>2</ul>",
		);
		doc.append(copy);
		expect(copy.document).toBe(doc);
		expect(doc.all("b").map((x) => mutable.stringify(x))).toEqual([
			'<b id="z">x</b>',
			"<b>y</b>",
		]);
		expect(mutable.stringify(doc)).toBe(
			'<ul><li class=a>1 <b id="z">x</b><li>2</ul><ul><li class=a>1 <b>y</b><li>2</ul>',
		);
	});

	test("clones of partly read subtrees", () => {
		let doc = mutable.parse("<div><p>a<b>b</b></p><p>c<i>d</i></p></div>");
		let div = doc.find("div")!;
		doc.find("i")!.setAttr("x", "1");
		let copy = div.clone();
		expect(mutable.stringify(copy)).toBe(
			'<div><p>a<b>b</b></p><p>c<i x="1">d</i></p></div>',
		);
		copy.find("b")!.remove();
		expect(mutable.stringify(copy)).toBe(
			'<div><p>a</p><p>c<i x="1">d</i></p></div>',
		);
		expect(mutable.stringify(div)).toBe(
			'<div><p>a<b>b</b></p><p>c<i x="1">d</i></p></div>',
		);
	});

	test("replacing children detaches every read child once", () => {
		let doc = mutable.parse("<p>a<b>b</b><i>c</i></p>");
		let p = doc.find("p")!;
		let [a, b, i] = p.children;
		p.text = "x";
		for (let child of [a, b, i]) expect(child.parent).toBeUndefined();
		expect(p.children.length).toBe(1);
		expect(mutable.stringify(doc)).toBe("<p>x</p>");
		p.append(b, i);
		expect(b.parent).toBe(p);
		expect(mutable.stringify(doc)).toBe("<p>x<b>b</b><i>c</i></p>");

		let fresh = mutable.parse("<p>a<b>b</b></p>");
		fresh.find("p")!.html = "<i>y</i>";
		expect(mutable.stringify(fresh)).toBe("<p><i>y</i></p>");
		expect(fresh.find("b")).toBeUndefined();
	});

	test("replacing children with own children keeps them", () => {
		let doc = mutable.parse("<p>a<b>b</b></p>");
		let p = doc.find("p")!;
		let b = p.find("b")!;
		p.text = "";
		p.append(b);
		let s = unwrap(p);
		expect(s.children?.length).toBe(2);
		expect(mutable.stringify(doc)).toBe("<p><b>b</b></p>");
	});

	test("a failed replacement still leaves a consistent tree", () => {
		let doc = mutable.parse("<div><p>a</p></div>");
		let div = doc.find("div")!;
		let p = div.find("p")!;
		let s = unwrap(p);
		expect(() => p.append(div)).toThrow(TypeError);
		expect(s.parent).toBe(unwrap(div));
		expect(mutable.stringify(doc)).toBe("<div><p>a</p></div>");
	});

	test("rename and void checks read unread children", () => {
		let doc = mutable.parse("<p>a</p><div><b>b</b></div><i></i>");
		expect(() => {
			doc.find("p")!.name = "img";
		}).toThrow(TypeError);
		expect(() => {
			doc.find("div")!.name = "script";
		}).toThrow(TypeError);
		doc.find("i")!.name = "br";
		expect(mutable.stringify(doc)).toBe("<p>a</p><div><b>b</b></div><br>");
		let fresh = mutable.parse("<div>x</div>");
		fresh.find("div")!.name = "script";
		expect(mutable.stringify(fresh)).toBe("<script>x</script>");
	});

	test("fragments read their children on demand", () => {
		let doc = mutable.parse("<div></div>");
		let div = doc.find("div")!;
		div.html = "<p><b>1</b></p><p><b>2</b></p>";
		let s = unwrap(div);
		expect(made(s)).toBe(3);
		expect(div.all("b").map((x) => x.text)).toEqual(["1", "2"]);
		expect(div.find("b")?.document).toBe(doc);
		expect(div.find("b")?.start).toBeUndefined();
		expect(mutable.stringify(doc)).toBe(
			"<div><p><b>1</b></p><p><b>2</b></p></div>",
		);
		let svg = mutable.parse("<svg></svg>").find("svg")!;
		svg.html = "<clippath><rect/></clippath>";
		expect(svg.find("clipPath rect")?.name).toBe("rect");
	});

	test("unread subtrees moved under new ancestors match where they are", () => {
		let doc = mutable.parse(
			"<nav><div class=d><p><i>x</i></p></div></nav><section></section>",
		);
		let div = doc.find("div")!;
		let s = unwrap(div);
		doc.find("section")!.append(div);
		expect(s.children).toBeUndefined();
		expect(doc.all("section i").map((x) => x.text)).toEqual(["x"]);
		expect(doc.all("nav i")).toEqual([]);
		expect(doc.all("section > .d > p > i").length).toBe(1);
		expect(doc.all("nav + section i").length).toBe(1);
		expect(doc.all(":root > div i").length).toBe(1);
		expect(doc.all(":root > p i")).toEqual([]);
		expect(doc.all(":not(nav) > div p").length).toBe(1);
	});

	test("unread subtrees moved to another document match there", () => {
		let from = mutable.parse("<ul><li><b>1</b></li><li><b>2</b></li></ul>");
		let to = mutable.parse("<main><h2></h2></main>");
		let ul = from.find("ul")!;
		to.find("main")!.append(ul);
		expect(to.all("main > h2 + ul li:last-child b").map((x) => x.text)).toEqual(
			["2"],
		);
		expect(to.all(":root > li").length).toBe(0);
		expect(to.all(":root ul li").length).toBe(2);
		expect(from.all("b")).toEqual([]);
		expect(to.find("b")?.document).toBe(to);
	});

	test("unread clones match under their new ancestors", () => {
		let doc = mutable.parse("<div><p><b>x</b></p></div><aside></aside>");
		let copy = doc.find("div")!.clone();
		expect(copy.all("div b").length).toBe(1);
		expect(copy.all("aside b")).toEqual([]);
		expect(copy.all("p > b").length).toBe(1);
		expect(copy.find("b")?.matches(":root > p > b")).toBe(true);
		doc.find("aside")!.append(copy);
		expect(doc.all("aside div b").length).toBe(1);
		expect(doc.all("div b").length).toBe(2);
		expect(doc.all("div + aside > div b").length).toBe(1);
	});

	test("sibling selectors at the edge of an unread subtree see edits", () => {
		let doc = mutable.parse("<h2>a</h2><div><p>x</p></div><div><p>y</p></div>");
		let [h2, first, second] = doc.children as Element[];
		expect(doc.all("h2 + div p").map((x) => x.text)).toEqual(["x"]);
		h2.name = "h3";
		expect(doc.all("h2 + div p")).toEqual([]);
		expect(doc.all("h3 ~ div p").map((x) => x.text)).toEqual(["x", "y"]);
		first.remove();
		expect(doc.all("h3 + div p").map((x) => x.text)).toEqual(["y"]);
		expect(doc.all("div:first-of-type p").map((x) => x.text)).toEqual(["y"]);
		doc.prepend(first);
		expect(doc.all("div:first-child p").map((x) => x.text)).toEqual(["x"]);
		expect(doc.all("div:nth-child(3) p").map((x) => x.text)).toEqual(["y"]);
		expect(doc.all("div:last-child > p").map((x) => x.text)).toEqual(["y"]);
		expect(unwrap(second).children?.length).toBe(1);
	});

	test("ids of two trees in one query keep their own sibling ranks", () => {
		let doc = mutable.parse("<ul><li>a</li><li>b</li><li>c</li></ul><ol></ol>");
		let ol = doc.find("ol")!;
		ol.html = "<li><i>1</i></li><li><i>2</i></li>";
		let moved = mutable.parse("<div><li><i>3</i></li></div>").find("div")!;
		doc.append(moved);
		expect(doc.all("li:nth-child(2)").map((x) => x.text)).toEqual(["b", "2"]);
		expect(doc.all("li:first-child i").map((x) => x.text)).toEqual(["1", "3"]);
		expect(doc.all("li:only-child i").map((x) => x.text)).toEqual(["3"]);
		expect(doc.all("li + li i").map((x) => x.text)).toEqual(["2"]);
		expect(doc.all("ul ~ div li").map((x) => x.text)).toEqual(["3"]);
	});

	test("element queries can look above their root", () => {
		let doc = mutable.parse("<main><section><p><i>x</i></p></section></main>");
		let section = doc.find("section")!;
		expect(section.all("main i").length).toBe(1);
		expect(section.all("main > section > p > i").length).toBe(1);
		expect(section.all("section i").length).toBe(1);
		expect(section.all("aside i")).toEqual([]);
		doc.find("main")!.name = "aside";
		expect(section.all("aside i").length).toBe(1);
		expect(section.find("main i")).toBeUndefined();
	});

	test("queries match a reparse of what edited documents serialize", () => {
		for (let seed = 1; seed <= 200; seed++) {
			let doc = mutable.parse(SOURCES[seed % SOURCES.length]);
			let other = mutable.parse(SOURCES[(seed * 3) % SOURCES.length]);
			let pick = random(seed * 17);
			for (let step = 0; step < 5; step++) edit(doc, other, pick);
			let again = mutable.parse(mutable.stringify(doc));
			if (shape(again) !== shape(doc)) continue;
			for (let selector of SELECTORS) {
				let outer = (list: Element[]) => list.map(shape);
				let left = outer(doc.all(selector));
				let right = outer(again.all(selector));
				if (left.join() !== right.join())
					expect([seed, selector, left]).toEqual([seed, selector, right]);
			}
		}
	});

	describe("cold, warm, and hydrated queries agree", () => {
		const STRUCTURAL = [
			"li:nth-child(2)",
			"li:nth-last-child(1)",
			"li:nth-of-type(2n+1)",
			"b:last-of-type",
			"i:first-of-type",
			"p:only-of-type",
			"li + li",
			"li ~ li > b",
			"h2 + div p",
			"div ~ div p:last-child",
			":is(li, p):nth-child(odd)",
			":not(li:first-child) > b",
			"ul > :not(:is(li:nth-child(2), li:last-child))",
			":is(:not(ul) > p, li:first-child + li) i",
			"div:nth-child(2) > p > i",
			":root:last-child p",
			"section li:nth-of-type(2) b",
		];
		const PROTO = [
			"[__proto__]",
			"[__proto__=x]",
			"[__PROTO__]",
			":not([__proto__])",
			"p:not([__proto__=x])",
			"[__proto__] i",
			"[constructor]",
			"[toString]",
			"[hasOwnProperty=y]",
		];
		const STRUCTURE = `<ol><li>0<li>00</ol><h2>t</h2><div><p><i>1</i></p><p>2</p></div><div><ul><li><b>a</b><li><b>b</b><b>c</b><li><i>d</i></ul><p __proto__=x constructor toString hasOwnProperty=y><i>e</i></p></div><section><ul><li>f<li><b>g</b></ul></section>`;
		const ALL = [...STRUCTURAL, ...PROTO, ...SELECTORS];

		/** The documents to compare: cold, warmed by other queries, and hydrated. */
		function variants(source: string): [string, Document][] {
			let warm = mutable.parse(source);
			warm.all("li");
			warm.find("i");
			warm.all("ul > li:nth-child(2) b");
			let hydrated = mutable.parse(source);
			force(hydrated);
			// The first half is read, so one query sees states, then ids.
			let half = mutable.parse(source);
			let top = half.children;
			for (let node of top.slice(0, Math.ceil(top.length / 2))) force(node);
			return [
				["warm", warm],
				["hydrated", hydrated],
				["half", half],
			];
		}

		test("on fresh documents, for every selector", () => {
			for (let source of [STRUCTURE, ...SOURCES]) {
				for (let selector of ALL) {
					let cold = mutable.parse(source);
					let expected = found(cold.all(selector));
					for (let [name, doc] of variants(source)) {
						let actual = found(doc.all(selector));
						if (actual.join() !== expected.join())
							expect([name, selector, actual]).toEqual([
								name,
								selector,
								expected,
							]);
					}
					let first = mutable.parse(source).find(selector);
					expect(first && found([first])[0]).toBe(expected[0]);
				}
			}
		});

		test("__proto__ is never an attribute, read or not", () => {
			for (let doc of [
				mutable.parse(STRUCTURE),
				...variants(STRUCTURE).map((x) => x[1]),
			]) {
				expect(doc.all("[__proto__]")).toEqual([]);
				expect(doc.all("[__proto__=x]")).toEqual([]);
				expect(doc.all("p:not([__proto__])").length).toBe(3);
				expect(doc.all("[constructor]").length).toBe(1);
				expect(doc.all("[hasOwnProperty=y] > i").length).toBe(1);
				let p = doc.find("[constructor]")!;
				expect(p.getAttr("__proto__")).toBeUndefined();
				expect(p.hasAttr("__proto__")).toBe(false);
				expect(p.matches("[__proto__]")).toBe(false);
				expect(Object.hasOwn(p.attributes, "__proto__")).toBe(false);
			}
		});

		/**
		 * Run `setup` on a cold and on a hydrated document, then compare what
		 * every selector finds, first cold, then again once warm.
		 */
		function twin(source: string, setup: (doc: Document) => void) {
			let cold = mutable.parse(source);
			let hydrated = mutable.parse(source);
			force(hydrated);
			setup(cold);
			setup(hydrated);
			expect(mutable.stringify(cold)).toBe(mutable.stringify(hydrated));
			for (let round = 0; round < 2; round++) {
				for (let selector of ALL) {
					let left = cold.all(selector).map((x) => `${x.start}${shape(x)}`);
					let right = hydrated
						.all(selector)
						.map((x) => `${x.start}${shape(x)}`);
					if (left.join() !== right.join())
						expect([round, selector, left]).toEqual([round, selector, right]);
				}
			}
			force(cold);
			expect(shape(cold)).toBe(shape(hydrated));
		}

		test("after renames and reorders of warmed nodes", () => {
			twin(STRUCTURE, (doc) => {
				doc.all("li:nth-child(2)");
				doc.find("h2")!.name = "h3";
				let [first, second] = doc.all(":root:is(div)");
				doc.prepend(second);
				first.after(doc.children[0]);
				let ul = doc.find("ul")!;
				ul.prepend(ul.children[2]);
				doc.find("section")!.name = "aside";
			});
		});

		test("after moving unread subtrees under new ancestors", () => {
			twin(STRUCTURE, (doc) => {
				let section = doc.find("section")!;
				section.prepend(doc.find("div > ul")!);
				section.find("li")!.append(doc.find("div")!);
				doc.find("ol")!.append(doc.find("section > ul")!);
			});
		});

		test("with unread clones beside their originals", () => {
			twin(STRUCTURE, (doc) => {
				let ul = doc.find("ul")!;
				ul.before(ul.clone());
				ul.after(ul.clone());
				let li = ul.find("li:nth-child(2)")!;
				li.before(li.clone());
				doc.prepend(doc.find("div")!.clone());
			});
		});

		test("with fragments of other trees whose ids overlap", () => {
			twin(STRUCTURE, (doc) => {
				let ul = doc.find("ul")!;
				let other = mutable.parse(STRUCTURE).find("ul")!;
				ul.after(other);
				let li = ul.find("li")!;
				li.html = "<b>x</b><b>y</b>";
				let parts = mutable.parse("<li><b>p</b></li><li><b>q</b><b>r</b></li>");
				ul.append(...parts.children);
				doc.find("section ul")!.html = "<li><b>s</b><li><i>t</i>";
				doc
					.find("h2")!
					.after(...mutable.parse("<div><p><i>u</i></p></div>").children);
			});
		});
	});

	test("random edits match documents with every state read", () => {
		for (let seed = 1; seed <= 300; seed++) {
			let source = SOURCES[seed % SOURCES.length];
			let other = SOURCES[(seed * 7) % SOURCES.length] || "<p>o</p>";
			let lazy = mutable.parse(source);
			let eager = mutable.parse(source);
			let lazyOther = mutable.parse(other);
			let eagerOther = mutable.parse(other);
			force(eager);
			force(eagerOther);
			let a = random(seed);
			let b = random(seed);
			for (let step = 0; step < 8; step++) {
				let x = edit(lazy, lazyOther, a);
				let y = edit(eager, eagerOther, b);
				if (x !== y) expect([seed, step, x]).toEqual([seed, step, y]);
				let left = mutable.stringify(lazy);
				let right = mutable.stringify(eager);
				if (left !== right)
					expect([seed, step, left]).toEqual([seed, step, right]);
				expect(mutable.stringify(lazyOther)).toBe(
					mutable.stringify(eagerOther),
				);
				let selector = SELECTORS[(seed + step) % SELECTORS.length];
				expect(found(lazy.all(selector))).toEqual(found(eager.all(selector)));
				expect(lazy.text).toBe(eager.text);
			}
			expect(shape(lazy)).toBe(shape(eager));
			expect(shape(lazyOther)).toBe(shape(eagerOther));
		}
	});

	test("edited documents reparse to what they serialize", () => {
		for (let seed = 1; seed <= 100; seed++) {
			let doc = mutable.parse(SOURCES[seed % SOURCES.length]);
			let other = mutable.parse(SOURCE);
			let pick = random(seed * 31);
			for (let step = 0; step < 6; step++) edit(doc, other, pick);
			let output = mutable.stringify(doc);
			expect(mutable.stringify(mutable.parse(output))).toBe(output);
		}
	});
});
