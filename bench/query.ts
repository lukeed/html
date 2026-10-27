import { selectAll, selectOne } from "css-select";
import { textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import * as lol from "lol-html";
import { parse as nhp } from "node-html-parser";
import { ELEMENT_NODE, TEXT_NODE, parse as ultra } from "ultrahtml";
import { querySelector, querySelectorAll } from "ultrahtml/selector";

import * as html from "../src/index";
import * as mutable from "../src/mutable/index";
import * as suite from "./suite";

import type { AnyNode, Element as DomElement } from "domhandler";
import type { Node as UltraNode } from "ultrahtml";
import type { Suite } from "./suite";

type Seo = {
	title: string | undefined;
	description: (string | undefined)[];
	viewport: (string | undefined)[];
	canonical: (string | undefined)[];
	links: (string | undefined)[];
	images: (string | undefined)[];
};

function empty(): Seo {
	return {
		title: "",
		description: [],
		viewport: [],
		canonical: [],
		links: [],
		images: [],
	};
}

function attr(node: UltraNode | undefined, key: string): string | undefined {
	return node && node.type === ELEMENT_NODE ? node.attributes[key] : undefined;
}

function ultraText(node: UltraNode | undefined): string {
	if (!node) return "";
	if (node.type === TEXT_NODE) return node.value;
	let output = "";
	for (let child of node.children ?? []) output += ultraText(child);
	return output;
}

export const query: Suite = {
	id: "query",
	title: "parse + query",
	about:
		"Parse each page, then read what an SEO linter needs: the `head > title` text, the `content` of `meta[name=description]` and `meta[name=viewport]`, the `href` of `link[rel=canonical]` and every `a`, and the `alt` of every `img`. Streaming candidates register the same selectors and never build a tree.",
	candidates: [
		{
			name: "@lukeed/html",
			run(xs) {
				return xs.map((x): Seo => {
					let doc = html.parse(x.html);
					return {
						title: doc.find("head > title")?.text,
						description: doc
							.all("meta[name=description]")
							.map((el) => el.getAttr("content")),
						viewport: doc
							.all("meta[name=viewport]")
							.map((el) => el.getAttr("content")),
						canonical: doc
							.all("link[rel=canonical]")
							.map((el) => el.getAttr("href")),
						links: doc.all("a").map((el) => el.getAttr("href")),
						images: doc.all("img").map((el) => el.getAttr("alt")),
					};
				});
			},
		},
		{
			name: "@lukeed/html/mutable",
			run(xs) {
				return xs.map((x): Seo => {
					let doc = mutable.parse(x.html);
					return {
						title: doc.find("head > title")?.text,
						description: doc
							.all("meta[name=description]")
							.map((el) => el.getAttr("content")),
						viewport: doc
							.all("meta[name=viewport]")
							.map((el) => el.getAttr("content")),
						canonical: doc
							.all("link[rel=canonical]")
							.map((el) => el.getAttr("href")),
						links: doc.all("a").map((el) => el.getAttr("href")),
						images: doc.all("img").map((el) => el.getAttr("alt")),
					};
				});
			},
		},
		{
			name: "lol-html (wasm), streaming",
			run(xs) {
				return xs.map((x): Seo => {
					let seo = empty();
					let rewriter = new lol.HTMLRewriter("utf8", () => {});
					rewriter.on("head > title", {
						text: (t: { text: string }) => void (seo.title += t.text),
					});
					rewriter.on("meta[name=description]", {
						element: (e: lol.Element) =>
							void seo.description.push(e.getAttribute("content")),
					});
					rewriter.on("meta[name=viewport]", {
						element: (e: lol.Element) =>
							void seo.viewport.push(e.getAttribute("content")),
					});
					rewriter.on("link[rel=canonical]", {
						element: (e: lol.Element) =>
							void seo.canonical.push(e.getAttribute("href")),
					});
					rewriter.on("a", {
						element: (e: lol.Element) =>
							void seo.links.push(e.getAttribute("href")),
					});
					rewriter.on("img", {
						element: (e: lol.Element) =>
							void seo.images.push(e.getAttribute("alt")),
					});
					rewriter.write(x.bytes);
					rewriter.end();
					return seo;
				});
			},
		},
		{
			name: "ultrahtml + selector",
			run(xs) {
				return xs.map((x): Seo => {
					let doc = ultra(x.html);
					return {
						title: ultraText(querySelector(doc, "head > title")),
						description: querySelectorAll(doc, "meta[name=description]").map(
							(el) => attr(el, "content"),
						),
						viewport: querySelectorAll(doc, "meta[name=viewport]").map((el) =>
							attr(el, "content"),
						),
						canonical: querySelectorAll(doc, "link[rel=canonical]").map((el) =>
							attr(el, "href"),
						),
						links: querySelectorAll(doc, "a").map((el) => attr(el, "href")),
						images: querySelectorAll(doc, "img").map((el) => attr(el, "alt")),
					};
				});
			},
		},
		{
			name: "htmlparser2 + css-select",
			run(xs) {
				return xs.map((x): Seo => {
					let doc = parseDocument(x.html);
					let title = selectOne<AnyNode, DomElement>("head > title", doc);
					let pick = (selector: string, key: string) =>
						selectAll<AnyNode, DomElement>(selector, doc).map(
							(el) => el.attribs[key],
						);
					return {
						title: title ? textContent(title) : undefined,
						description: pick("meta[name=description]", "content"),
						viewport: pick("meta[name=viewport]", "content"),
						canonical: pick("link[rel=canonical]", "href"),
						links: pick("a", "href"),
						images: pick("img", "alt"),
					};
				});
			},
		},
		{
			name: "node-html-parser",
			run(xs) {
				return xs.map((x): Seo => {
					let doc = nhp(x.html);
					let pick = (selector: string, key: string) =>
						doc.querySelectorAll(selector).map((el) => el.getAttribute(key));
					return {
						title: doc.querySelector("head > title")?.innerText,
						description: pick("meta[name=description]", "content"),
						viewport: pick("meta[name=viewport]", "content"),
						canonical: pick("link[rel=canonical]", "href"),
						links: pick("a", "href"),
						images: pick("img", "alt"),
					};
				});
			},
		},
		...(suite.REWRITER
			? [
					{
						name: "Bun HTMLRewriter (native), streaming",
						run(xs: { html: string }[]) {
							return xs.map((x): Seo => {
								let seo = empty();
								new HTMLRewriter()
									.on("head > title", {
										text: (t) => void (seo.title += t.text),
									})
									.on("meta[name=description]", {
										element: (e) =>
											void seo.description.push(
												e.getAttribute("content") ?? undefined,
											),
									})
									.on("meta[name=viewport]", {
										element: (e) =>
											void seo.viewport.push(
												e.getAttribute("content") ?? undefined,
											),
									})
									.on("link[rel=canonical]", {
										element: (e) =>
											void seo.canonical.push(
												e.getAttribute("href") ?? undefined,
											),
									})
									.on("a", {
										element: (e) =>
											void seo.links.push(e.getAttribute("href") ?? undefined),
									})
									.on("img", {
										element: (e) =>
											void seo.images.push(e.getAttribute("alt") ?? undefined),
									})
									.transform(x.html);
								return seo;
							});
						},
					},
				]
			: []),
	],
};
