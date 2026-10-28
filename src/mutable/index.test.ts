import { describe, expect, test } from "bun:test";

import * as html from "../index";
import * as mutable from "./index";

const SOURCE = `<!doctype html>
<html>
<head>
	<title>Hi &amp; bye</title>
	<link rel="canonical" href="https://example.com/?a=1&amp;b=2">
</head>
<body>
	<!-- note -->
	<nav><a href="/" CLASS=x>Home</a><a href="/about/">About</a></nav>
	<p>One <b>two</b> &lt;three&gt;<p>implied
	<ul><li>1<li>2</ul>
	<img src=a.png>
	<script>if (a < b) "&amp;"</script>
</body>
</html>`;

const SELECTORS = [
	"*",
	"a",
	"nav > a + a",
	"head title",
	"link[rel=canonical]",
	"a.x",
	"p:first-of-type",
	"li:nth-child(2)",
	":root",
	"img:not([alt])",
	"[constructor]",
];

describe("parse()", () => {
	test("round-trips unedited documents exactly", () => {
		for (let source of [
			SOURCE,
			"",
			"text",
			"<p>a<p>b",
			"<a href=x/>",
			"<!--x",
			"<svg><path/></svg>",
		]) {
			let doc = mutable.parse(source);
			expect(mutable.stringify(doc)).toBe(source);
			for (let el of doc.all("*")) {
				expect(mutable.stringify(el)).toBe(source.slice(el.start, el.end));
			}
		}
	});

	test("matches the immutable variant for every selector", () => {
		let a = html.parse(SOURCE);
		let b = mutable.parse(SOURCE);
		for (let selector of SELECTORS) {
			expect(b.all(selector).map((x) => x.start)).toEqual(
				a.all(selector).map((x) => x.start),
			);
		}
	});

	test("reads the same values as the immutable variant", () => {
		let a = html.parse(SOURCE);
		let b = mutable.parse(SOURCE);
		for (let [x, y] of a
			.all("*")
			.map((el, i) => [el, b.all("*")[i]] as const)) {
			expect(y?.name).toBe(x.name);
			expect(y?.attributes).toEqual(x.attributes);
			expect(y?.text).toBe(x.text);
			expect(y?.html).toBe(x.html);
		}
	});

	test("returns the same object for the same node", () => {
		let doc = mutable.parse(SOURCE);
		expect(doc.find("a")).toBe(doc.all("a")[0]);
		expect(doc.find("a")?.parent).toBe(doc.find("nav"));
		expect(doc.find("html")?.parent).toBe(doc);
	});
});

describe("attributes", () => {
	test("setAttr() adds or replaces, and output is escaped", () => {
		let doc = mutable.parse('<a href="/">x</a>');
		let a = doc.find("a");
		a?.setAttr("HREF", "/next?a=1&b=2");
		a?.setAttr("title", `say "hi" > bye`);
		expect(a?.attributes).toEqual({
			href: "/next?a=1&b=2",
			title: `say "hi" > bye`,
		});
		expect(mutable.stringify(doc)).toBe(
			'<a href="/next?a=1&amp;b=2" title="say &quot;hi&quot; > bye">x</a>',
		);
		let again = mutable.parse(mutable.stringify(doc)).find("a");
		expect(again?.attributes).toEqual(a?.attributes ?? {});
	});

	test("setAttr() rejects invalid names", () => {
		let a = mutable.parse("<a>").find("a");
		for (let bad of ["", "a b", 'a"', "a>", "a=b", "a/"]) {
			expect(() => a?.setAttr(bad, "x")).toThrow(SyntaxError);
		}
	});

	test("removeAttr() removes, and keeps boolean attributes bare", () => {
		let doc = mutable.parse('<input type="checkbox" disabled checked>');
		let input = doc.find("input");
		input?.removeAttr("CHECKED");
		input?.removeAttr("missing");
		expect(input?.hasAttr("checked")).toBe(false);
		expect(mutable.stringify(doc)).toBe('<input type="checkbox" disabled>');
	});

	test("attributes are frozen and replaced on edit", () => {
		let a = mutable.parse("<a id=x>").find("a");
		let before = a?.attributes;
		a?.setAttr("id", "y");
		expect(Object.isFrozen(before)).toBe(true);
		expect(before).toEqual({ id: "x" });
		expect(a?.attributes).toEqual({ id: "y" });
	});

	test("selectors see edits", () => {
		let doc = mutable.parse("<a></a><a></a>");
		doc.all("a")[1].setAttr("data-x", "1");
		expect(doc.all('[data-x="1"]')).toEqual([doc.all("a")[1]]);
		expect(doc.find("a")?.matches("[data-x]")).toBe(false);
	});

	test("only the edited tag is rebuilt", () => {
		let source = "<div  class='a'><p  id=x>t</p></div>";
		let doc = mutable.parse(source);
		doc.find("p")?.setAttr("id", "y");
		expect(mutable.stringify(doc)).toBe(
			`<div  class='a'><p id="y">t</p></div>`,
		);
	});
});

describe("text and html", () => {
	test("text setter replaces children and escapes", () => {
		let doc = mutable.parse("<p>a <b>b</b></p>");
		let p = doc.find("p");
		if (p) p.text = "<c> & d";
		expect(p?.text).toBe("<c> & d");
		expect(p?.children.length).toBe(1);
		expect(mutable.stringify(doc)).toBe("<p>&lt;c&gt; &amp; d</p>");
		expect(mutable.parse(mutable.stringify(doc)).find("p")?.text).toBe(
			"<c> & d",
		);
	});

	test("text inside script is not escaped", () => {
		let doc = mutable.parse("<script>x</script>");
		let script = doc.find("script");
		if (script) script.text = "a < b && c";
		expect(mutable.stringify(doc)).toBe("<script>a < b && c</script>");
	});

	test("html setter parses children", () => {
		let doc = mutable.parse("<ul><li>a</li></ul>");
		let ul = doc.find("ul");
		if (ul) ul.html = "<li>b<li>c";
		expect(ul?.all("li").map((x) => x.text)).toEqual(["b", "c"]);
		expect(ul?.html).toBe("<li>b<li>c");
		expect(mutable.stringify(doc)).toBe("<ul><li>b<li>c</ul>");
		expect(doc.find("li")?.document).toBe(doc);
		expect(doc.find("li")?.start).toBeUndefined();
	});

	test("html setter on raw text elements sets text", () => {
		let doc = mutable.parse("<title>a</title><style>x</style>");
		let title = doc.find("title");
		let style = doc.find("style");
		if (title) title.html = "b &amp; <i>c</i>";
		if (style) style.html = "a > b {}";
		expect(title?.text).toBe("b & <i>c</i>");
		expect(style?.text).toBe("a > b {}");
	});

	test("moved text is escaped for its new parent", () => {
		let doc = mutable.parse(
			"<script>a<b</script><div>x &lt; y</div><title>c<d</title><p></p>",
		);
		let [script, div, title, p] = ["script", "div", "title", "p"].map((x) =>
			doc.find(x),
		);
		let [a] = script?.children ?? [];
		let [x] = div?.children ?? [];
		let [c] = title?.children ?? [];
		if (a && x && c) {
			div?.append(a);
			script?.append(x);
			p?.append(c);
		}
		expect(mutable.stringify(doc)).toBe(
			"<script>x < y</script><div>a&lt;b</div><title></title><p>c&lt;d</p>",
		);
		expect(a && mutable.stringify(a)).toBe("a&lt;b");
		a?.remove();
		expect(a && mutable.stringify(a)).toBe("a<b");
	});

	test("text value setter", () => {
		let doc = mutable.parse("<p>a</p>");
		let [node] = doc.find("p")?.children ?? [];
		if (node?.type === "text") node.value = "<b>";
		expect(mutable.stringify(doc)).toBe("<p>&lt;b&gt;</p>");
	});

	test("comment and directive setters validate", () => {
		let doc = mutable.parse("<!doctype html><!-- a -->");
		let [directive, comment] = doc.children;
		if (directive.type === "directive") {
			directive.value = "DOCTYPE html";
			expect(() => (directive.value = "a>b")).toThrow(SyntaxError);
		}
		if (comment.type === "comment") {
			comment.value = " b ";
			expect(() => (comment.value = "-->")).toThrow(SyntaxError);
		}
		expect(mutable.stringify(doc)).toBe("<!DOCTYPE html><!-- b -->");
	});
});

describe("children", () => {
	test("append, prepend, before, after", () => {
		let doc = mutable.parse("<ul><li>b</li></ul>");
		let ul = doc.find("ul");
		let li = doc.find("li");
		ul?.append(...mutable.parse("<li>d</li>").children);
		ul?.prepend("a");
		li?.after("c");
		li?.before("x");
		expect(mutable.stringify(doc)).toBe("<ul>ax<li>b</li>c<li>d</li></ul>");
		expect(ul?.all("li").map((x) => x.text)).toEqual(["b", "d"]);
	});

	test("document append and prepend", () => {
		let doc = mutable.parse("<p>a</p>");
		doc.append("z");
		doc.prepend(...mutable.parse("<!doctype html>").children);
		expect(mutable.stringify(doc)).toBe("<!doctype html><p>a</p>z");
	});

	test("replace and remove", () => {
		let doc = mutable.parse("<p>a<b>b</b><i>c</i></p>");
		let b = doc.find("b");
		doc.find("i")?.replace("C", ...mutable.parse("<em>!</em>").children);
		b?.remove();
		expect(b?.parent).toBeUndefined();
		expect(b && mutable.stringify(b)).toBe("<b>b</b>");
		expect(mutable.stringify(doc)).toBe("<p>aC<em>!</em></p>");
	});

	test("moving a node within the document", () => {
		let doc = mutable.parse("<a>1</a><b>2</b><c>3</c>");
		let [a, b, c] = ["a", "b", "c"].map((x) => doc.find(x));
		if (a && c) c.after(a);
		if (b) b.prepend(...(c ? [c] : []));
		expect(mutable.stringify(doc)).toBe("<b><c>3</c>2</b><a>1</a>");
		expect(a?.start).toBe(0);
	});

	test("moving a node to another document", () => {
		let from = mutable.parse("<p>x</p>");
		let to = mutable.parse("<div></div>");
		let p = from.find("p");
		if (p) to.find("div")?.append(p);
		expect(p?.document).toBe(to);
		expect(p?.start).toBeUndefined();
		expect(mutable.stringify(from)).toBe("");
		expect(mutable.stringify(to)).toBe("<div><p>x</p></div>");
	});

	test("rejects invalid inserts", () => {
		let doc = mutable.parse("<div><p>x</p></div><img>");
		let div = doc.find("div");
		let p = doc.find("p");
		expect(() => p?.append(div ?? "")).toThrow(TypeError);
		expect(() => div?.append(div)).toThrow(TypeError);
		expect(() => doc.find("img")?.append("x")).toThrow(TypeError);
		p?.remove();
		expect(() => p?.before("x")).toThrow(TypeError);
	});

	test("edits inside implied-close elements", () => {
		let doc = mutable.parse("<p>a<p>b");
		doc.find("p")?.append("!");
		expect(mutable.stringify(doc)).toBe("<p>a!<p>b");
	});

	test("new elements serialize with closing tags", () => {
		let doc = mutable.parse("<div></div>");
		let div = doc.find("div");
		if (div) div.html = "<span>a</span><br>";
		let span = doc.find("span");
		span?.setAttr("class", "x");
		expect(mutable.stringify(doc)).toBe(
			'<div><span class="x">a</span><br></div>',
		);
	});
});

describe("Document", () => {
	test("position() refers to the original source", () => {
		let doc = mutable.parse("<p>\n<img>");
		let img = doc.find("img");
		doc.prepend("lots\nof\ntext");
		expect(doc.position(img?.start ?? -1)).toEqual({ line: 2, column: 1 });
		expect(doc.source).toBe("<p>\n<img>");
	});
});

describe("reads", () => {
	let doc = mutable.parse(
		"<!doctype html><!-- c --><nav><a CLASS=x>a</a><p></p></nav>",
	);

	test("getAttr, find, matches, closest", () => {
		let nav = doc.find("nav");
		let a = nav?.find("a");
		expect(a?.getAttr("Class")).toBe("x");
		expect(a?.getAttr("id")).toBeUndefined();
		expect(nav?.find("li")).toBeUndefined();
		expect(a?.matches("nav > .x")).toBe(true);
		expect(a?.closest("nav")).toBe(nav);
		expect(a?.closest("p")).toBeUndefined();
	});

	test("skips template contents, unless the template is the root", () => {
		let doc = mutable.parse(
			'<template><p class="x">a</p></template><p class="x">b</p>',
		);
		expect(doc.all(".x").map((x) => x.text)).toEqual(["b"]);
		expect(doc.find("template")?.all(".x").map((x) => x.text)).toEqual(["a"]);
	});

	test(":empty sees edits", () => {
		let p = doc.find("p:empty");
		expect(p?.name).toBe("p");
		p?.append("x");
		expect(doc.find("p:empty")).toBeUndefined();
	});

	test("leaf values", () => {
		let [directive, comment] = doc.children;
		expect(directive.type === "directive" && directive.value).toBe(
			"doctype html",
		);
		expect(comment.type === "comment" && comment.value).toBe(" c ");
		let [text] = doc.find("a")?.children ?? [];
		expect(text?.type === "text" && text.value).toBe("a");
	});

	test("document range", () => {
		expect(doc.start).toBe(0);
		expect(doc.end).toBe(doc.source.length);
	});
});
