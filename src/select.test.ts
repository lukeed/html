import { describe, expect, test } from "bun:test";
import { selectAll } from "css-select";
import { parseDocument } from "htmlparser2";

import * as select from "./select";
import * as tree from "./tree";
import * as values from "./values";

const HTML = `<!doctype html>
<html lang="en-US">
<head>
	<title>Fixture</title>
	<meta name="description" content="A page">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="canonical" href="https://example.com/">
	<link rel="stylesheet alternate" href="/a.css">
</head>
<body class="home page">
	<header id="top"><nav><a href="/">Home</a><a href="/about/" class="active">About</a></nav></header>
	<main>
		<h1>Title</h1>
		<p class="lead intro">One <a href="https://other.com" target="_blank" rel="noopener">ext</a></p>
		<p>Two <img src="a.png" alt="A"><img src="b.png"></p>
		<p></p>
		<ul><li>1</li><li class="x">2</li><li>3</li><li>4</li><li class="x">5</li></ul>
		<div data-Mixed="Value" data-list="a b c" lang="en-GB"><span>s</span><!-- c --></div>
		<svg viewBox="0 0 1 1"><clipPath id="c"><rect/></clipPath></svg>
		<template id="t"><p class="x">t</p><template><li class="x">n</li></template></template>
	</main>
	<footer><p>Bye</p></footer>
</body>
</html>`;

const SELECTORS = [
	"*",
	"a",
	"A",
	"head > title",
	"head>title",
	"meta[name=description]",
	'meta[name="viewport"]',
	"link[rel=canonical]",
	"link[rel~=alternate]",
	"html[lang|=en]",
	"[lang|=en]",
	"a[href^=https]",
	'a[href$="/"]',
	"a[href*=other]",
	"[data-mixed=value i]",
	"[data-mixed=Value]",
	"[data-list~=b]",
	"img[alt]",
	"img:not([alt])",
	"#top",
	"#top a",
	".active",
	"p.lead.intro",
	".lead, .active",
	"body.home",
	"main > p",
	"main p",
	"h1 + p",
	"h1 ~ p",
	"p + p",
	"li:first-child",
	"li:last-child",
	"li:nth-child(2n+1)",
	"li:nth-child(odd)",
	"li:nth-child(even)",
	"li:nth-child(3)",
	"li:nth-child(-n+2)",
	"li:nth-last-child(2)",
	"li.x:nth-of-type(2)",
	"p:first-of-type",
	"p:last-of-type",
	"span:only-child",
	"p:empty",
	":root",
	"li:not(.x)",
	"li:not(:first-child):not(:last-child)",
	":is(h1, footer p)",
	":where(nav) a",
	"svg rect",
	"ul > li.x + li",
	"header a.active, main img[src$='.png']",
	"template",
	"template p",
	"main .x",
	"p, li",
];

const CLASSES = `<p id=p1 class="foo"></p><p id=p2 class="foobar"></p>
<p id=p3 class="a-foo foo-b"></p><p id=p4 class="\tfoo\n"></p>
<p id=p5 class="x\fFOO foo foo"></p><p id=p6 class=""></p><p id=p7 class></p>
<p id=p8 CLASS="bar" class="foo"></p><p id=p9 class="foo&#9;bar"></p>
<p id=p10 class="foo&nbsp;bar"></p><p id=p11 class="a b"></p><p id=p12 class=Foo></p>
<p id=p13 class=" \r\nfoo\u2028bar\u3000 "></p><p id=p14 class="foo\u00adbar"></p>`;

/** Each class selector and the `id` of every element it matches. */
const TOKENS: Record<string, string[]> = {
	".foo": ["p1", "p4", "p5", "p9", "p10", "p13"],
	".foobar": ["p2"],
	".oo": [],
	".fo": [],
	".a-foo": ["p3"],
	".foo-b": ["p3"],
	".FOO": ["p5"],
	".Foo": ["p12"],
	".bar": ["p8", "p9", "p10", "p13"],
	".foo.bar": ["p9", "p10", "p13"],
	".foo.foo": ["p1", "p4", "p5", "p9", "p10", "p13"],
	".x.FOO.foo": ["p5"],
	".a": ["p11"],
	".a\\ b": [],
	".a\\20 b": [],
	".\\66 oo": ["p1", "p4", "p5", "p9", "p10", "p13"],
	".foo\\ad bar": ["p14"],
	"[class~=foo]": ["p1", "p4", "p5", "p9", "p10", "p13"],
	"[class~=foo i]": ["p1", "p4", "p5", "p9", "p10", "p12", "p13"],
	'[class~="a b"]': [],
	"[class~='']": [],
	'[class="a b"]': ["p11"],
	"[class='']": ["p6", "p7"],
	"[class]:not(.foo)": ["p2", "p3", "p6", "p7", "p8", "p11", "p12", "p14"],
	"p:not([class])": [],
};

describe("select", () => {
	let ours = tree.build(HTML);
	let theirs = parseDocument(HTML, { withStartIndices: true });

	for (let selector of SELECTORS) {
		test(`matches css-select :: ${selector}`, () => {
			let expected = selectAll(selector, theirs).map((x) => x.startIndex ?? -1);
			let actual = select
				.all(ours, 0, select.compile(selector))
				.map((id) => ours.start[id]);
			expect(actual).toEqual(expected);
		});
	}

	for (let [selector, expected] of Object.entries(TOKENS)) {
		test(`matches class tokens :: ${selector}`, () => {
			let t = tree.build(CLASSES);
			let ids = select
				.all(t, 0, select.compile(selector))
				.map((id) => values.attribute(t, id, "id"));
			expect(ids).toEqual(expected);
		});
	}

	test("scopes results to the root", () => {
		let main = select.all(ours, 0, select.compile("main"))[0];
		let inside = select.all(ours, main, select.compile("p"));
		let everywhere = select.all(ours, 0, select.compile("p"));
		expect(inside).toHaveLength(3);
		expect(everywhere).toHaveLength(4);
	});

	test("matches foreign tags by exact case, like browsers", () => {
		let exact = select.all(ours, 0, select.compile("clipPath"));
		let lower = select.all(ours, 0, select.compile("clippath"));
		expect(exact.map((id) => ours.name[id])).toEqual(["clipPath"]);
		expect(lower).toEqual([]);
	});

	test("skips template contents, unless the template is the root", () => {
		let [outer] = select.all(ours, 0, select.compile("template"));
		let [inner] = select.all(ours, outer, select.compile("template"));
		let names = (root: number) =>
			select.all(ours, root, select.compile(".x")).map((id) => ours.name[id]);
		expect(names(outer)).toEqual(["p"]);
		expect(names(inner)).toEqual(["li"]);
		expect(select.all(ours, outer, select.compile("li"))).toEqual([]);
	});

	test("stops at the limit", () => {
		expect(select.all(ours, 0, select.compile("li"), 2)).toHaveLength(2);
	});

	test("supports escapes in identifiers and strings", () => {
		let doc = tree.build(`<a id="a:b" class="1x" title='say "hi"'></a>`);
		for (let selector of ["#a\\:b", ".\\31 x", '[title="say \\"hi\\""]']) {
			expect(select.all(doc, 0, select.compile(selector))).toHaveLength(1);
		}
	});

	test("rejects an unterminated string", () => {
		expect(() => select.compile('[title="x]')).toThrow(SyntaxError);
	});

	test("ignores inherited object keys as attributes", () => {
		for (let selector of ["[constructor]", "[toString]", "[__proto__]"]) {
			expect(select.all(ours, 0, select.compile(selector))).toEqual([]);
		}
	});

	test("caches compiled selectors", () => {
		expect(select.compile("a > b")).toBe(select.compile("a > b"));
	});

	for (let bad of [
		"",
		"a >",
		"[href",
		"a:hover",
		":nth-child(x)",
		"a,,b",
		"'x'",
	]) {
		test(`rejects invalid selector :: ${JSON.stringify(bad)}`, () => {
			expect(() => select.compile(bad)).toThrow(SyntaxError);
		});
	}
});
