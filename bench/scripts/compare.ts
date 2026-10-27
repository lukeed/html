import { parseDocument } from "htmlparser2";

import * as html from "../../src/index";
import * as mutable from "../../src/mutable/index";
import * as tree from "../../src/tree";
import * as values from "../../src/values";
import * as corpus from "./corpus";

import type { ChildNode } from "domhandler";

type Line = string;

function theirs(html: string): Line[] {
	let output: Line[] = [];
	let walk = (nodes: ChildNode[], depth: number): void => {
		for (let node of nodes) {
			if (
				node.type === "tag" ||
				node.type === "script" ||
				node.type === "style"
			) {
				output.push(`${depth} <${node.name}> ${JSON.stringify(node.attribs)}`);
				walk(node.children, depth + 1);
			} else if (node.type === "text") {
				let last = output.at(-1);
				if (last?.startsWith(`${depth} #text `))
					output[output.length - 1] = last + node.data;
				else output.push(`${depth} #text ${node.data}`);
			} else if (node.type === "comment") {
				output.push(`${depth} #comment`);
			}
		}
	};
	walk(parseDocument(html).children, 0);
	return output;
}

function ours(html: string): Line[] {
	let t = tree.build(html);
	let depth = [-1];
	let output: Line[] = [];
	for (let id = 1; id < t.kind.length; id++) {
		let d = depth[t.parent[id]] + 1;
		depth[id] = d;
		if (t.kind[id] === tree.ELEMENT) {
			output.push(
				`${d} <${t.name[id]}> ${JSON.stringify(values.attributes(t, id))}`,
			);
		} else if (t.kind[id] === tree.TEXT) {
			let last = output.at(-1);
			if (last?.startsWith(`${d} #text `))
				output[output.length - 1] = last + values.value(t, id);
			else output.push(`${d} #text ${values.value(t, id)}`);
		} else if (t.kind[id] === tree.COMMENT) {
			output.push(`${d} #comment`);
		}
	}
	return output;
}

let failed = 0;

for (let page of await corpus.load()) {
	let expected = theirs(page.html);
	let actual = ours(page.html);
	let at = expected.findIndex((line, i) => line !== actual[i]);
	if (at === -1 && expected.length === actual.length) {
		console.log(
			"ok  ",
			String(expected.length).padStart(6),
			"nodes ",
			page.name,
		);
		continue;
	}
	failed++;
	let index = at === -1 ? expected.length : at;
	console.log(
		"FAIL",
		String(expected.length).padStart(6),
		"nodes ",
		page.name,
		"at node",
		index,
	);
	console.log("  expected:", (expected[index] ?? "<end>").slice(0, 200));
	console.log("  actual:  ", (actual[index] ?? "<end>").slice(0, 200));
}

for (let page of await corpus.load()) {
	let doc = mutable.parse(page.html);
	let count = doc.all("*").length;
	for (let a of doc.all("a[href]")) a.setAttr("rel", "noopener");
	for (let img of doc.all("img:not([alt])")) img.setAttr("alt", "");
	let title = doc.find("title");
	if (title) title.text = "Edited";

	let output = mutable.stringify(doc);
	let again = html.parse(output);
	let problems = [
		again.all("*").length !== count &&
			`element count ${again.all("*").length} != ${count}`,
		again.all("a[href]:not([rel=noopener])").length > 0 &&
			"a[href] without rel",
		again.all("img:not([alt])").length > 0 && "img without alt",
		title && again.find("title")?.text !== "Edited" && "title text",
		mutable.stringify(mutable.parse(page.html)) !== page.html &&
			"unedited round trip",
	].filter((x) => typeof x === "string");

	if (problems.length === 0) {
		console.log("ok   edit round trip", page.name);
		continue;
	}
	failed++;
	console.log("FAIL edit round trip", page.name, problems.join(", "));
}

process.exitCode = failed > 0 ? 1 : 0;
