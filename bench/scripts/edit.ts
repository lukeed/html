import { selectAll, selectOne } from "css-select";
import render from "dom-serializer";
import { Text as DomText } from "domhandler";
import { appendChild, removeElement } from "domutils";
import { parseDocument } from "htmlparser2";
import * as lol from "lol-html";
import { parse as nhp } from "node-html-parser";
import { ELEMENT_NODE, TEXT_NODE, parse as ultra, renderSync } from "ultrahtml";
import { querySelector, querySelectorAll } from "ultrahtml/selector";

import * as mutable from "../../src/mutable/index";
import * as suite from "./suite";

import type { AnyNode, Element as DomElement } from "domhandler";
import type { Suite } from "./suite";

const DECODER = new TextDecoder();

export const roundtrip: Suite = {
	id: "roundtrip",
	title: "parse + stringify",
	about:
		"Parse each page and serialize it again with no edits. Only libraries that can serialize a tree are listed.",
	candidates: [
		{
			name: "@lukeed/html/mutable",
			run: (xs) => xs.map((x) => mutable.stringify(mutable.parse(x.html))),
		},
		{
			name: "ultrahtml",
			run: (xs) => xs.map((x) => renderSync(ultra(x.html))),
		},
		{
			name: "htmlparser2 + dom-serializer",
			run: (xs) => xs.map((x) => render(parseDocument(x.html))),
		},
		{
			name: "node-html-parser",
			run: (xs) => xs.map((x) => nhp(x.html).toString()),
		},
	],
};

export const edit: Suite = {
	id: "edit",
	title: "parse + edit + stringify",
	about:
		'Parse each page, set `rel="noopener"` on every `a[href]`, set `alt=""` on every `img` without one, replace the `<title>` text, then serialize. ultrahtml filters images by hand, because its selector parser throws on `img:not([alt])` under Bun.',
	candidates: [
		{
			name: "@lukeed/html/mutable",
			run(xs) {
				return xs.map((x) => {
					let doc = mutable.parse(x.html);
					for (let a of doc.all("a[href]")) a.setAttr("rel", "noopener");
					for (let img of doc.all("img:not([alt])")) img.setAttr("alt", "");
					let title = doc.find("title");
					if (title) title.text = "Edited";
					return mutable.stringify(doc);
				});
			},
		},
		{
			name: "lol-html (wasm), streaming",
			run(xs) {
				return xs.map((x) => {
					let chunks: Uint8Array[] = [];
					let rewriter = new lol.HTMLRewriter(
						"utf8",
						(chunk: Uint8Array) => void chunks.push(chunk),
					);
					rewriter.on("a[href]", {
						element: (e: lol.Element) => e.setAttribute("rel", "noopener"),
					});
					rewriter.on("img:not([alt])", {
						element: (e: lol.Element) => e.setAttribute("alt", ""),
					});
					rewriter.on("title", {
						element: (e: lol.Element) => e.setInnerContent("Edited"),
					});
					rewriter.write(x.bytes);
					rewriter.end();
					return chunks.map((chunk) => DECODER.decode(chunk)).join("");
				});
			},
		},
		{
			name: "ultrahtml + selector",
			run(xs) {
				return xs.map((x) => {
					let doc = ultra(x.html);
					for (let a of querySelectorAll(doc, "a[href]")) {
						if (a.type === ELEMENT_NODE) a.attributes.rel = "noopener";
					}
					for (let img of querySelectorAll(doc, "img")) {
						if (img.type === ELEMENT_NODE && !("alt" in img.attributes))
							img.attributes.alt = "";
					}
					let title = querySelector(doc, "title");
					if (title && title.type === ELEMENT_NODE) {
						title.children = [
							{
								type: TEXT_NODE,
								value: "Edited",
								parent: title,
								loc: title.loc,
							},
						];
					}
					return renderSync(doc);
				});
			},
		},
		{
			name: "htmlparser2 + css-select + dom-serializer",
			run(xs) {
				return xs.map((x) => {
					let doc = parseDocument(x.html);
					for (let a of selectAll<AnyNode, DomElement>("a[href]", doc))
						a.attribs.rel = "noopener";
					for (let img of selectAll<AnyNode, DomElement>("img:not([alt])", doc))
						img.attribs.alt = "";
					let title = selectOne<AnyNode, DomElement>("title", doc);
					if (title) {
						for (let child of [...title.children]) removeElement(child);
						appendChild(title, new DomText("Edited"));
					}
					return render(doc);
				});
			},
		},
		{
			name: "node-html-parser",
			run(xs) {
				return xs.map((x) => {
					let doc = nhp(x.html);
					for (let a of doc.querySelectorAll("a[href]"))
						a.setAttribute("rel", "noopener");
					for (let img of doc.querySelectorAll("img:not([alt])"))
						img.setAttribute("alt", "");
					doc.querySelector("title")?.set_content("Edited");
					return doc.toString();
				});
			},
		},
		...(suite.REWRITER
			? [
					{
						name: "Bun HTMLRewriter (native), streaming",
						run: (xs: { html: string }[]) =>
							xs.map((x) =>
								new HTMLRewriter()
									.on("a[href]", {
										element: (e) => void e.setAttribute("rel", "noopener"),
									})
									.on("img:not([alt])", {
										element: (e) => void e.setAttribute("alt", ""),
									})
									.on("title", {
										element: (e) => void e.setInnerContent("Edited"),
									})
									.transform(x.html),
							),
					},
				]
			: []),
	],
};
