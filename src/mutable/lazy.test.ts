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
	"li:nth-last-child(1)",
	"li:nth-of-type(2n+1)",
	"ul > :not(:is(li:nth-child(2), li:last-child))",
	":root:last-child p",
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
	test("queries and child reads reuse the same states in source order", () => {
		let doc = mutable.parse("<main><p class=x>A</p><p class=y>B</p></main>");
		let first = doc.find("main > p.x")!;
		let main = doc.find("main")!;
		let [a, b] = main.children;
		expect(a).toBe(first);
		force(doc);
		expect(doc.find("main > p.x")).toBe(first);
		let [left, right] = doc.all("p");
		expect(a).toBe(left);
		expect(b).toBe(right);
		expect(unwrap(b).attrs).toBeUndefined();
		expect(b).toBe(doc.find("p.y")!);
		expect(unwrap(b).attrs).toBeUndefined();
		expect(unwrap(main).dirty).toBe(false);
		expect(unwrap(doc).dirty).toBe(false);
	});

	test("clean scans see edits outside their scope and fall back after internal edits", () => {
		let doc = mutable.parse(
			"<main><header>H</header><section><p class=x>A</p><p>B</p></section></main>",
		);
		force(doc);
		let main = doc.find("main")!;
		let section = doc.find("section")!;
		let first = section.find("header + section > p")!;
		expect(first.text).toBe("A");
		doc.find("header")!.name = "h1";
		main.setAttr("class", "edited");
		expect(unwrap(section).dirty).toBe(false);
		for (let root of [doc, section]) {
			expect(root.find(".edited > h1 + section > p:first-child")).toBe(first);
			expect(root.find("header + section p")).toBeUndefined();
		}
		first.removeAttr("class");
		first.name = "span";
		mutable.stringify(doc);
		expect(unwrap(section).dirty).toBe(true);
		expect(section.all("p").map((x) => x.text)).toEqual(["B"]);
		expect(doc.find("section > span")).toBe(first);
		expect(section.all(".x")).toEqual([]);
	});

	test("clean descendants see reordered and removed siblings", () => {
		let doc = mutable.parse(
			"<ul><li><b>A</b></li><li><b>B</b></li><li><b>C</b></li></ul><ol></ol>",
		);
		force(doc);
		let ul = doc.find("ul")!;
		let [a, b, c] = ul.all("li");
		let bold = b.find("b")!;
		expect(doc.find("li:nth-child(2) > b")).toBe(bold);
		ul.prepend(c);
		a.remove();
		expect(unwrap(b).dirty).toBe(false);
		expect(b.find("li:first-child + li > b")).toBe(bold);
		expect(doc.find("li:nth-child(2) > b")).toBe(bold);
		doc.find("ol")!.append(b);
		expect(doc.find("ol > li:only-child b")).toBe(bold);
		expect(doc.all("b").map((x) => x.text)).toEqual(["C", "B"]);
	});

	test("hydrated clones and adopted subtrees use their new ancestors", () => {
		let from = mutable.parse(
			"<article><section><b class=x>A</b></section></article>",
		);
		force(from);
		let original = from.find("section")!;
		let first = original.find("b")!;
		let copy = original.clone();
		let copied = copy.find("b")!;
		let to = mutable.parse("<main><aside></aside><nav></nav></main>");
		to.find("aside")!.append(copy);
		to.find("nav")!.append(original);
		expect(unwrap(copy).dirty).toBe(false);
		expect(unwrap(original).dirty).toBe(false);
		expect(copied).not.toBe(first);
		expect(to.find("aside section b")).toBe(copied);
		expect(to.find("nav section b")).toBe(first);
		expect(to.find("article b")).toBeUndefined();
		expect(from.all("b")).toEqual([]);
		expect(copied.document).toBe(to);
		expect(first.document).toBe(to);
		copied.removeAttr("class");
		expect(to.all(".x")).toEqual([first]);
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

	test("reading children makes the unread subtree in one pass", () => {
		let doc = mutable.parse("<div><p><b>x</b></p><i></i></div>y");
		let [div, text] = doc.children;
		expect(text.type).toBe("text");
		expect(made(unwrap(doc))).toBe(7);
		expect(div.type === "element" && div.children.length).toBe(2);
		expect(made(unwrap(doc))).toBe(7);

		doc = mutable.parse("<div><p><b>x</b></p><i></i></div>y");
		let p = doc.find("p");
		expect(made(unwrap(doc))).toBe(5);
		expect(p?.children.length).toBe(1);
		expect(made(unwrap(doc))).toBe(7);
	});

	test("queries make only matches, their ancestors, and their siblings", () => {
		let doc = mutable.parse(
			"<div><p>a</p><p>b<span>c</span></p></div><div><p><span>d</span></p></div>",
		);
		let span = doc.find("span");
		expect(span?.text).toBe("c");
		// document, both divs, both p, and the span and its sibling text.
		expect(made(unwrap(doc))).toBe(7);
		expect(unwrap(doc.children[1]).children).toBeUndefined();
		let up = span?.parent;
		let top = up?.type === "element" ? up.parent : undefined;
		expect(top?.type === "element" && top.parent).toBe(doc);
	});

	test("cold and hydrated queries agree with the immutable parser", () => {
		for (let source of SOURCES) {
			let tree = html.parse(source);
			let hydrated = mutable.parse(source);
			force(hydrated);
			for (let selector of SELECTORS) {
				let expected = tree.all(selector).map((x) => x.start);
				let cold = mutable.parse(source);
				expect(cold.find(selector)?.start).toBe(expected[0]);
				expect(
					mutable
						.parse(source)
						.all(selector)
						.map((x) => x.start),
				).toEqual(expected);
				expect(hydrated.all(selector).map((x) => x.start)).toEqual(expected);
			}
		}
	});

	test(":empty on states with unread children", () => {
		let doc = mutable.parse("<p></p><div><p></p></div>");
		expect(doc.find("div")?.matches(":empty")).toBe(false);
		expect(doc.find("p")?.matches(":empty")).toBe(true);
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
		let count = made(unwrap(doc));
		expect(p.text).toBe("a & b");
		expect(made(unwrap(doc))).toBe(count);
		doc.find("b")!.text = "B";
		expect(doc.text).toBe("a & B&amp;");
	});

	test("adoption updates read and unread descendants", () => {
		let from = mutable.parse("<ul><li><b>A</b></li><li><b>B</b></li></ul>");
		let to = mutable.parse("<main><h2></h2></main>");
		let first = from.find("b")!;
		let ul = from.find("ul")!;
		to.find("main")!.append(ul);
		expect(to.find("main b")).toBe(first);
		let second = to.find("main > h2 + ul li:last-child b")!;
		expect(second.text).toBe("B");
		for (let node of [ul, first, second]) {
			expect(node.document).toBe(to);
			expect(node.start).toBeUndefined();
		}
		expect(from.find("b")).toBeUndefined();
		expect(mutable.stringify(from)).toBe("");
	});

	test("unread clones match under their new ancestors and stay independent", () => {
		let doc = mutable.parse("<ul><li class=x><b>A</b></ul><aside></aside>");
		let ul = doc.find("ul")!;
		let copy = ul.clone();
		expect(unwrap(copy).children).toBeUndefined();
		expect(mutable.stringify(copy)).toBe("<ul><li class=x><b>A</b></ul>");
		expect(copy.find("aside b")).toBeUndefined();
		doc.find("aside")!.append(copy);
		let [original, copied] = doc.all("b");
		expect(original).toBe(ul.find("b")!);
		expect(copied).toBe(doc.find("ul + aside > ul b")!);
		expect(copied).not.toBe(original);
		copied.text = "B";
		expect(original.text).toBe("A");
		expect(mutable.stringify(doc)).toBe(
			"<ul><li class=x><b>A</b></ul><aside><ul><li class=x><b>B</b></ul></aside>",
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

	test("replacing children detaches every read child", () => {
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

	test("fragments read their children on demand", () => {
		let doc = mutable.parse("<div></div>");
		let div = doc.find("div")!;
		div.html = "<p><b>1</b></p><p><b>2</b></p>";
		expect(made(unwrap(div))).toBe(3);
		expect(div.all("b").map((x) => x.text)).toEqual(["1", "2"]);
	});

	test("unread subtrees moved under new ancestors match where they are", () => {
		let doc = mutable.parse(
			"<nav><div><p><i>x</i></p></div></nav><section></section>",
		);
		let div = doc.find("div")!;
		doc.find("section")!.append(div);
		expect(unwrap(div).children).toBeUndefined();
		let i = doc.find("nav + section > div i")!;
		expect(i.text).toBe("x");
		expect(div.find("i")).toBe(i);
		expect(doc.find("nav i")).toBeUndefined();
	});

	test("sibling selectors at the edge of an unread subtree see edits", () => {
		let doc = mutable.parse("<h2>a</h2><div><p>x</p></div><div><p>y</p></div>");
		let [h2, first, second] = doc.all("h2, div");
		h2.name = "h3";
		expect(unwrap(second).children).toBeUndefined();
		expect(doc.find("h2 + div p")).toBeUndefined();
		first.remove();
		expect(doc.find("h3 + div p")?.text).toBe("y");
		expect(doc.find("div:last-child > p")?.text).toBe("y");
	});

	test("ids from different trees in one query keep their own sibling ranks", () => {
		for (let read of [false, true]) {
			let doc = mutable.parse(
				"<ul><li>a</li><li>b</li><li>c</li></ul><ol></ol>",
			);
			doc.find("ol")!.html = "<li><i>1</i></li><li><i>2</i></li>";
			doc.append(mutable.parse("<div><li><i>3</i></li></div>").find("div")!);
			if (read) force(doc);
			expect(doc.all("li:nth-child(2)").map((x) => x.text)).toEqual(["b", "2"]);
			expect(doc.all("li:only-child i").map((x) => x.text)).toEqual(["3"]);
			expect(doc.all("li + li i").map((x) => x.text)).toEqual(["2"]);
		}
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

	test("queries ignore a parsed __proto__ attribute but match other own keys", () => {
		let doc = mutable.parse(
			"<p __proto__=x constructor hasOwnProperty=y><i></i></p>",
		);
		expect(doc.all("[__proto__], [__proto__=x]")).toEqual([]);
		let p = doc.find("p:not([__proto__])[constructor]")!;
		expect(p.children[0]).toBe(doc.find("[hasOwnProperty=y] > i")!);
		expect(p.matches("[__proto__]")).toBe(false);
		expect(Object.hasOwn(p.attributes, "__proto__")).toBe(false);
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
});
