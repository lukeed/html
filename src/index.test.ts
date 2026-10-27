import { describe, expect, test } from "bun:test";

import * as html from "./index";

const SOURCE = `<!doctype html>
<html>
<head>
	<title>Hi &amp; bye</title>
	<link rel="canonical" href="https://example.com/?a=1&amp;b=2">
</head>
<body>
	<!-- note -->
	<nav><a href="/" CLASS="x">Home</a></nav>
	<p>One <b>two</b> &lt;three&gt;</p>
	<script>if (a < b) "&amp;"</script>
</body>
</html>`;

describe("parse()", () => {
	let doc = html.parse(SOURCE);

	test("returns a document", () => {
		expect(doc.type).toBe("document");
		expect(doc.source).toBe(SOURCE);
		expect(doc.start).toBe(0);
		expect(doc.end).toBe(SOURCE.length);
	});

	test("exposes top-level children", () => {
		expect(doc.children.map((x) => x.type)).toEqual([
			"directive",
			"text",
			"element",
		]);
	});

	test("returns the same object for the same node", () => {
		expect(doc.query("a")).toBe(doc.queryAll("a")[0]);
		expect(doc.query("a")?.parent).toBe(doc.query("nav"));
	});

	test("never throws on malformed HTML", () => {
		for (let bad of ["<", "<a", "</", "<!--", "<a href='x", "<<<>>>", "\0"]) {
			expect(() => html.parse(bad).queryAll("*")).not.toThrow();
		}
	});
});

describe("Document", () => {
	let doc = html.parse(SOURCE);

	test("query() returns `undefined` without a match", () => {
		expect(doc.query("video")).toBeUndefined();
	});

	test("queryAll() rejects invalid selectors", () => {
		expect(() => doc.queryAll("a[")).toThrow(SyntaxError);
	});

	test("position() maps offsets to 1-based lines and columns", () => {
		let link = doc.query("link");
		expect(doc.position(0)).toEqual({ line: 1, column: 1 });
		expect(doc.position(link?.start ?? -1)).toEqual({ line: 5, column: 2 });
		expect(doc.position(SOURCE.length)).toEqual({ line: 13, column: 8 });
	});
});

describe("Element", () => {
	let doc = html.parse(SOURCE);

	test("name, start, end", () => {
		let a = doc.query("a");
		expect(a?.name).toBe("a");
		expect(SOURCE.slice(a?.start, a?.end)).toBe(
			'<a href="/" CLASS="x">Home</a>',
		);
	});

	test("attributes are lowercased, decoded, and frozen", () => {
		let link = doc.query("link");
		expect(link?.attributes).toEqual({
			rel: "canonical",
			href: "https://example.com/?a=1&b=2",
		});
		expect(Object.isFrozen(link?.attributes)).toBe(true);
		expect(doc.query("a")?.attr("class")).toBe("x");
		expect(doc.query("a")?.attr("Class")).toBe("x");
		expect(doc.query("a")?.attr("id")).toBeUndefined();
		expect(doc.query("a")?.has("CLASS")).toBe(true);
		expect(doc.query("a")?.has("constructor")).toBe(false);
	});

	test("text decodes descendants", () => {
		expect(doc.query("title")?.text).toBe("Hi & bye");
		expect(doc.query("p")?.text).toBe("One two <three>");
	});

	test("text does not decode raw text elements", () => {
		expect(doc.query("script")?.text).toBe('if (a < b) "&amp;"');
	});

	test("html is the inner source", () => {
		expect(doc.query("p")?.html).toBe("One <b>two</b> &lt;three&gt;");
	});

	test("children include text and comments", () => {
		let body = doc.query("body");
		expect(body?.children.map((x) => x.type)).toEqual([
			"text",
			"comment",
			"text",
			"element",
			"text",
			"element",
			"text",
			"element",
			"text",
		]);
	});

	test("query() and queryAll() are scoped", () => {
		let nav = doc.query("nav");
		expect(nav?.query("a")?.text).toBe("Home");
		expect(nav?.queryAll("p")).toEqual([]);
	});

	test("matches() and closest()", () => {
		let a = doc.query("a");
		expect(a?.matches("nav > a.x")).toBe(true);
		expect(a?.matches("p a")).toBe(false);
		expect(a?.closest("a")).toBe(a);
		expect(a?.closest("body")?.name).toBe("body");
		expect(a?.closest("p")).toBeUndefined();
	});

	test("parent of the root element is the document", () => {
		expect(doc.query("html")?.parent).toBe(doc);
	});

	test("document links back", () => {
		expect(doc.query("a")?.document).toBe(doc);
	});
});

describe("Text, Comment, Directive", () => {
	let doc = html.parse(SOURCE);

	test("values", () => {
		let [directive] = doc.children;
		let comment = doc.query("body")?.children[1];
		let text = doc.query("title")?.children[0];

		expect(directive.type === "directive" && directive.value).toBe(
			"doctype html",
		);
		expect(comment?.type === "comment" && comment.value).toBe(" note ");
		expect(text?.type === "text" && text.value).toBe("Hi & bye");
		expect(text?.parent).toBe(doc.query("title"));
	});
});

describe("stringify()", () => {
	let doc = html.parse(SOURCE);

	test("returns the source of a document", () => {
		expect(html.stringify(doc)).toBe(SOURCE);
	});

	test("returns the source of a node", () => {
		let nav = doc.query("nav");
		expect(nav && html.stringify(nav)).toBe(
			'<nav><a href="/" CLASS="x">Home</a></nav>',
		);
	});

	test("round-trips every node", () => {
		let all = doc.queryAll("*");
		for (let el of all) {
			expect(html.stringify(el)).toBe(SOURCE.slice(el.start, el.end));
		}
	});
});
