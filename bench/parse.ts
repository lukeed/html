import { parseDocument } from "htmlparser2";
import { bench, do_not_optimize, group, summary } from "mitata";
import { parse as nhp } from "node-html-parser";
import { parse as parse5 } from "parse5";
import { parse as ultra } from "ultrahtml";

import * as html from "../src/index";
import * as mutable from "../src/mutable/index";
import * as corpus from "./corpus";

const pages = (await corpus.load()).map((x) => x.html);

/**
 * Build a full tree from Bun's HTMLRewriter callbacks.
 */
function rewriterTree(source: string): unknown {
	type Item = { name: string; attrs: [string, string][]; children: unknown[] };
	let root: Item = { name: "#document", attrs: [], children: [] };
	let stack = [root];

	new HTMLRewriter()
		.on("*", {
			element(el) {
				let item: Item = {
					name: el.tagName,
					attrs: [...el.attributes],
					children: [],
				};
				stack[stack.length - 1].children.push(item);
				if (!el.canHaveContent || el.selfClosing) return;
				stack.push(item);
				el.onEndTag(() => {
					stack.pop();
				});
			},
		})
		.onDocument({
			text(chunk) {
				stack[stack.length - 1].children.push(chunk.text);
			},
			comments(comment) {
				stack[stack.length - 1].children.push({ comment: comment.text });
			},
		})
		.transform(source);

	return root;
}

summary(() => {
	group("parse: full tree", () => {
		bench("@lukeed/html", () => {
			for (let page of pages) do_not_optimize(html.parse(page));
		})
			.baseline(true)
			.gc("inner");

		bench("@lukeed/html (eager: every attribute + text)", () => {
			for (let page of pages) {
				let doc = html.parse(page);
				for (let el of doc.all("*")) {
					do_not_optimize(el.attributes);
					for (let node of el.children)
						if (node.type === "text") do_not_optimize(node.value);
				}
			}
		}).gc("inner");

		bench("@lukeed/html/mutable", () => {
			for (let page of pages) do_not_optimize(mutable.parse(page));
		}).gc("inner");

		bench("htmlparser2", () => {
			for (let page of pages) do_not_optimize(parseDocument(page));
		}).gc("inner");

		bench("ultrahtml", () => {
			for (let page of pages) do_not_optimize(ultra(page));
		}).gc("inner");

		bench("node-html-parser", () => {
			for (let page of pages) do_not_optimize(nhp(page));
		}).gc("inner");

		bench("parse5", () => {
			for (let page of pages) do_not_optimize(parse5(page));
		}).gc("inner");

		if (typeof HTMLRewriter !== "undefined") {
			bench("Bun HTMLRewriter → tree", () => {
				for (let page of pages) do_not_optimize(rewriterTree(page));
			}).gc("inner");
		}
	});
});
