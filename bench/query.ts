import { selectAll, selectOne } from "css-select";
import { textContent } from "domutils";
import { parseDocument } from "htmlparser2";
import * as lol from "lol-html";
import { bench, do_not_optimize, group, summary } from "mitata";
import { parse as nhp } from "node-html-parser";
import { ELEMENT_NODE, parse as ultra } from "ultrahtml";
import { querySelector, querySelectorAll } from "ultrahtml/selector";

import * as html from "../src/index";
import * as mutable from "../src/mutable/index";
import * as corpus from "./corpus";

import type { AnyNode, Element as DomElement } from "domhandler";
import type { Node as UltraNode } from "ultrahtml";

const pages = (await corpus.load()).map((x) => x.html);
const bytes = pages.map((x) => new TextEncoder().encode(x));

type Seo = {
	title: string | undefined;
	description: (string | undefined)[];
	viewport: (string | undefined)[];
	canonical: (string | undefined)[];
	links: (string | undefined)[];
	images: (string | undefined)[];
};

function attr(node: UltraNode | undefined, key: string): string | undefined {
	return node && node.type === ELEMENT_NODE ? node.attributes[key] : undefined;
}

function ultraText(node: UltraNode | undefined): string {
	if (!node) return "";
	if (node.type === 2) return node.value;
	let output = "";
	for (let child of node.children ?? []) output += ultraText(child);
	return output;
}

summary(() => {
	group("seolint workload: parse + queries", () => {
		bench("@lukeed/html", () => {
			for (let page of pages) {
				let doc = html.parse(page);
				let seo: Seo = {
					title: doc.find("head > title")?.text,
					description: doc
						.all("meta[name=description]")
						.map((x) => x.attr("content")),
					viewport: doc
						.all("meta[name=viewport]")
						.map((x) => x.attr("content")),
					canonical: doc.all("link[rel=canonical]").map((x) => x.attr("href")),
					links: doc.all("a").map((x) => x.attr("href")),
					images: doc.all("img").map((x) => x.attr("alt")),
				};
				do_not_optimize(seo);
			}
		})
			.baseline(true)
			.gc("inner");

		bench("@lukeed/html/mutable", () => {
			for (let page of pages) {
				let doc = mutable.parse(page);
				let seo: Seo = {
					title: doc.find("head > title")?.text,
					description: doc
						.all("meta[name=description]")
						.map((x) => x.attr("content")),
					viewport: doc
						.all("meta[name=viewport]")
						.map((x) => x.attr("content")),
					canonical: doc.all("link[rel=canonical]").map((x) => x.attr("href")),
					links: doc.all("a").map((x) => x.attr("href")),
					images: doc.all("img").map((x) => x.attr("alt")),
				};
				do_not_optimize(seo);
			}
		}).gc("inner");

		bench("htmlparser2 + css-select", () => {
			for (let page of pages) {
				let doc = parseDocument(page);
				let title = selectOne<AnyNode, DomElement>("head > title", doc);
				let seo: Seo = {
					title: title ? textContent(title) : undefined,
					description: selectAll<AnyNode, DomElement>(
						"meta[name=description]",
						doc,
					).map((x) => x.attribs.content),
					viewport: selectAll<AnyNode, DomElement>(
						"meta[name=viewport]",
						doc,
					).map((x) => x.attribs.content),
					canonical: selectAll<AnyNode, DomElement>(
						"link[rel=canonical]",
						doc,
					).map((x) => x.attribs.href),
					links: selectAll<AnyNode, DomElement>("a", doc).map(
						(x) => x.attribs.href,
					),
					images: selectAll<AnyNode, DomElement>("img", doc).map(
						(x) => x.attribs.alt,
					),
				};
				do_not_optimize(seo);
			}
		}).gc("inner");

		bench("ultrahtml + selector", () => {
			for (let page of pages) {
				let doc = ultra(page);
				let seo: Seo = {
					title: ultraText(querySelector(doc, "head > title")),
					description: querySelectorAll(doc, "meta[name=description]").map(
						(x) => attr(x, "content"),
					),
					viewport: querySelectorAll(doc, "meta[name=viewport]").map((x) =>
						attr(x, "content"),
					),
					canonical: querySelectorAll(doc, "link[rel=canonical]").map((x) =>
						attr(x, "href"),
					),
					links: querySelectorAll(doc, "a").map((x) => attr(x, "href")),
					images: querySelectorAll(doc, "img").map((x) => attr(x, "alt")),
				};
				do_not_optimize(seo);
			}
		}).gc("inner");

		bench("node-html-parser", () => {
			for (let page of pages) {
				let doc = nhp(page);
				let seo: Seo = {
					title: doc.querySelector("head > title")?.innerText,
					description: doc
						.querySelectorAll("meta[name=description]")
						.map((x) => x.getAttribute("content")),
					viewport: doc
						.querySelectorAll("meta[name=viewport]")
						.map((x) => x.getAttribute("content")),
					canonical: doc
						.querySelectorAll("link[rel=canonical]")
						.map((x) => x.getAttribute("href")),
					links: doc.querySelectorAll("a").map((x) => x.getAttribute("href")),
					images: doc.querySelectorAll("img").map((x) => x.getAttribute("alt")),
				};
				do_not_optimize(seo);
			}
		}).gc("inner");

		bench("lol-html (wasm)", () => {
			for (let page of bytes) {
				let seo: Seo = {
					title: "",
					description: [],
					viewport: [],
					canonical: [],
					links: [],
					images: [],
				};
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
				rewriter.write(page);
				rewriter.end();
				do_not_optimize(seo);
			}
		}).gc("inner");

		if (typeof HTMLRewriter !== "undefined") {
			bench("Bun HTMLRewriter (native)", () => {
				for (let page of pages) {
					let seo: Seo = {
						title: "",
						description: [],
						viewport: [],
						canonical: [],
						links: [],
						images: [],
					};
					new HTMLRewriter()
						.on("head > title", { text: (t) => void (seo.title += t.text) })
						.on("meta[name=description]", {
							element: (e) =>
								void seo.description.push(
									e.getAttribute("content") ?? undefined,
								),
						})
						.on("meta[name=viewport]", {
							element: (e) =>
								void seo.viewport.push(e.getAttribute("content") ?? undefined),
						})
						.on("link[rel=canonical]", {
							element: (e) =>
								void seo.canonical.push(e.getAttribute("href") ?? undefined),
						})
						.on("a", {
							element: (e) =>
								void seo.links.push(e.getAttribute("href") ?? undefined),
						})
						.on("img", {
							element: (e) =>
								void seo.images.push(e.getAttribute("alt") ?? undefined),
						})
						.transform(page);
					do_not_optimize(seo);
				}
			}).gc("inner");
		}
	});
});
