import { describe, expect, test } from "bun:test";
import { selectAll } from "css-select";
import { parseDocument } from "htmlparser2";

import * as select from "./select";
import * as tree from "./tree";

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
];

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
