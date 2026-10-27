import { parseDocument } from "htmlparser2";
import { parse as nhp } from "node-html-parser";
import { parse as parse5 } from "parse5";
import { parse as ultra } from "ultrahtml";

import * as html from "../src/index";
import * as mutable from "../src/mutable/index";
import * as suite from "./suite";

import type { Suite } from "./suite";

type Item = { name: string; attrs: [string, string][]; children: unknown[] };

/**
 * Build a full tree from Bun's HTMLRewriter callbacks.
 */
function rewriterTree(source: string): Item {
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

export const parse: Suite = {
	id: "parse",
	title: "parse",
	about:
		'Parse each page into a full tree and keep it. @lukeed/html reads attributes and text lazily, so its "read all" row also reads every attribute and text value, which is the work the other parsers always do.',
	candidates: [
		{ name: "@lukeed/html", run: (xs) => xs.map((x) => html.parse(x.html)) },
		{
			name: "@lukeed/html, read all",
			run(xs) {
				return xs.map((x) => {
					let doc = html.parse(x.html);
					let output: unknown[] = [];
					for (let el of doc.all("*")) {
						output.push(el.attributes);
						for (let node of el.children)
							if (node.type === "text") output.push(node.value);
					}
					return [doc, output];
				});
			},
		},
		{
			name: "@lukeed/html/mutable",
			run: (xs) => xs.map((x) => mutable.parse(x.html)),
		},
		{ name: "ultrahtml", run: (xs) => xs.map((x) => ultra(x.html)) },
		{ name: "htmlparser2", run: (xs) => xs.map((x) => parseDocument(x.html)) },
		{ name: "node-html-parser", run: (xs) => xs.map((x) => nhp(x.html)) },
		{ name: "parse5", run: (xs) => xs.map((x) => parse5(x.html)) },
		...(suite.REWRITER
			? [
					{
						name: "Bun HTMLRewriter → tree",
						run: (xs: { html: string }[]) =>
							xs.map((x) => rewriterTree(x.html)),
					},
				]
			: []),
	],
};
