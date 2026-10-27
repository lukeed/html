import { selectAll, selectOne } from "css-select";
import render from "dom-serializer";
import { Text as DomText } from "domhandler";
import { appendChild, removeElement } from "domutils";
import { parseDocument } from "htmlparser2";
import * as lol from "lol-html";
import { bench, do_not_optimize, group, summary } from "mitata";
import { parse as nhp } from "node-html-parser";
import { ELEMENT_NODE, TEXT_NODE, parse as ultra, renderSync } from "ultrahtml";
import { querySelector, querySelectorAll } from "ultrahtml/selector";

import * as mutable from "../src/mutable/index";
import * as corpus from "./corpus";

import type { AnyNode, Element as DomElement } from "domhandler";

const pages = (await corpus.load()).map((x) => x.html);
const bytes = pages.map((x) => new TextEncoder().encode(x));
const decoder = new TextDecoder();

summary(() => {
	group("round trip: parse + stringify, no edits", () => {
		bench("@lukeed/html/mutable", () => {
			for (let page of pages)
				do_not_optimize(mutable.stringify(mutable.parse(page)));
		})
			.baseline(true)
			.gc("inner");

		bench("htmlparser2 + dom-serializer", () => {
			for (let page of pages) do_not_optimize(render(parseDocument(page)));
		}).gc("inner");

		bench("ultrahtml", () => {
			for (let page of pages) do_not_optimize(renderSync(ultra(page)));
		}).gc("inner");

		bench("node-html-parser", () => {
			for (let page of pages) do_not_optimize(nhp(page).toString());
		}).gc("inner");
	});
});

summary(() => {
	group("edit: set link rel, missing img alt, title text; stringify", () => {
		bench("@lukeed/html/mutable", () => {
			for (let page of pages) {
				let doc = mutable.parse(page);
				for (let a of doc.all("a[href]")) a.set("rel", "noopener");
				for (let img of doc.all("img:not([alt])")) img.set("alt", "");
				let title = doc.find("title");
				if (title) title.text = "Edited";
				do_not_optimize(mutable.stringify(doc));
			}
		})
			.baseline(true)
			.gc("inner");

		bench("htmlparser2 + css-select + dom-serializer", () => {
			for (let page of pages) {
				let doc = parseDocument(page);
				for (let a of selectAll<AnyNode, DomElement>("a[href]", doc))
					a.attribs.rel = "noopener";
				for (let img of selectAll<AnyNode, DomElement>("img:not([alt])", doc))
					img.attribs.alt = "";
				let title = selectOne<AnyNode, DomElement>("title", doc);
				if (title) {
					for (let child of [...title.children]) removeElement(child);
					appendChild(title, new DomText("Edited"));
				}
				do_not_optimize(render(doc));
			}
		}).gc("inner");

		bench("ultrahtml + selector", () => {
			for (let page of pages) {
				let doc = ultra(page);
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
						{ type: TEXT_NODE, value: "Edited", parent: title, loc: title.loc },
					];
				}
				do_not_optimize(renderSync(doc));
			}
		}).gc("inner");

		bench("node-html-parser", () => {
			for (let page of pages) {
				let doc = nhp(page);
				for (let a of doc.querySelectorAll("a[href]"))
					a.setAttribute("rel", "noopener");
				for (let img of doc.querySelectorAll("img:not([alt])"))
					img.setAttribute("alt", "");
				doc.querySelector("title")?.set_content("Edited");
				do_not_optimize(doc.toString());
			}
		}).gc("inner");

		bench("lol-html (wasm), streaming", () => {
			for (let page of bytes) {
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
				rewriter.write(page);
				rewriter.end();
				do_not_optimize(chunks.map((x) => decoder.decode(x)).join(""));
			}
		}).gc("inner");

		if (typeof HTMLRewriter !== "undefined") {
			bench("Bun HTMLRewriter (native), streaming", () => {
				for (let page of pages) {
					let output = new HTMLRewriter()
						.on("a[href]", {
							element: (e) => void e.setAttribute("rel", "noopener"),
						})
						.on("img:not([alt])", {
							element: (e) => void e.setAttribute("alt", ""),
						})
						.on("title", { element: (e) => void e.setInnerContent("Edited") })
						.transform(page);
					do_not_optimize(output);
				}
			}).gc("inner");
		}
	});
});
