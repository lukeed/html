import { describe, expect, test } from "bun:test";
import { parseDocument } from "htmlparser2";

import * as tree from "./tree";
import * as values from "./values";

import type { ChildNode } from "domhandler";

const CASES: Record<string, string> = {
	empty: "",
	"text only": "hello &amp; world",
	"basic document":
		"<!doctype html><html><head><title>Hi</title></head><body><p>x</p></body></html>",
	"uppercase tags": "<DIV ID=a><SPAN>x</SPAN></DIV>",
	"attributes, quoted": `<a href="x" title='y' data-z=z>t</a>`,
	"attributes, no value": "<input disabled checked>",
	"attributes, duplicates": `<a href="first" href="second">t</a>`,
	"attributes, mixed case": `<meta charSet="utf-8" ConTent=x>`,
	"attributes, entities": `<a href="?a=1&amp;b=2&lt;" title="&quot;q&quot;">t</a>`,
	"attributes, '>' in quotes": `<div title="a>b" data-x='c>d'>x</div>`,
	"attributes, unquoted slash": "<a href=/x/>t</a>",
	"attributes, newlines": `<a\n  href="x"\n  class="y"\n>t</a>`,
	"attributes, doubled quote": `<a href="/x"">link</a><p>Hello</p>`,
	"attributes, doubled single quote": `<a b='c''>x</a><p>y</p>`,
	"attributes, quote in name": `<div data-x"y>one</div><p>Hello</p><span z">two</span>`,
	"attributes, quote in unquoted value": `<div class=a"b>one</div><p>Hello</p><span title="t">two</span>`,
	"attributes, apostrophe in unquoted value": "<a b=c'd e=f>x</a>",
	"attributes, leading equals": "<a =b c>x</a>",
	"attributes, slash between": `<a b = "c" / d>x</a>`,
	"attributes, quote after value": `<a b="c"d e>x</a>`,
	"attributes, empty unquoted": "<a b= >x</a><a c=>y</a>",
	"self-closing svg, unquoted slash": "<svg><path d=M0/><path d=M1/></svg>",
	"self-closing svg, spaced slash": "<svg><path d=M0 / ><path/></svg>",
	"self-closing svg, quoted slash": `<svg><path d="M0/"/><path/></svg>`,
	"self-closing html": "<div/><span>x</span>",
	"void elements": "<p>a<br>b<img src=x>c<hr>d</p>",
	"implied p close": "<p>one<p>two<div>three</div>",
	"implied li close": "<ul><li>a<li>b</ul>",
	"implied table": "<table><tr><td>a<td>b<tr><td>c</table>",
	"implied option": "<select><option>a<option>b<optgroup><option>c</select>",
	"implied dd/dt": "<dl><dt>a<dd>b<dt>c</dl>",
	"implied heading": "<h1>a<h2>b</h2>",
	"implied a": "<a href=1>one<a href=2>two</a>",
	"body closes head": "<html><head><link rel=x><body>y</body>",
	"stray close p": "<div></p></div>",
	"stray close br": "<div></br></div>",
	"stray close tag": "<div></span>x</div>",
	"unclosed elements": "<div><span>x",
	misnested: "<b><i>x</b>y</i>",
	"nested form": "<form><form><input></form></form>",
	comment: "<!-- hi --><p>x</p>",
	"comment, unclosed": "<p>x<!-- never",
	"bogus comment": "<p>x</ 3>y</p>",
	"processing instruction": "<?xml version=1?><p>x</p>",
	directive: "<!DOCTYPE html><p>x</p>",
	"script, raw": `<script>if (a < b && c > d) document.write("<p>x</p>")</script>`,
	"script, uppercase close": "<script>x</SCRIPT>y",
	"script, unclosed": "<script>x<p>y",
	"style, raw": "<style>a > b { content: '&amp;' }</style>",
	"title, entities": "<title>a &amp; b <i>c</i></title>",
	textarea: "<textarea><b>&lt;x&gt;</b></textarea>",
	plaintext: "<plaintext><b>x</b></plaintext>",
	noscript: "<noscript><img src=x></noscript>",
	"lone <": "<p>a < b and c <3 d</p>",
	"text entities": "<p>&copy; &#169; &#xA9; &nbsp;&notanentity; &amp</p>",
	"svg names":
		"<svg viewBox='0 0 1 1'><clipPath id=c><rect/></clipPath><foreignObject><div>x</div></foreignObject></svg>",
	"svg self-closing": "<svg/><p>x</p>",
	"svg title": "<svg><title><b>x</b></title></svg>",
	math: "<math><mi>x</mi><mo>+</mo></math>",
	"image alias": "<image src=x>",
	whitespace: "\n  <div>\n\t<span> x </span>\n  </div>\n",
};

type Line = [depth: number, kind: string, detail: string];

function theirs(html: string): Line[] {
	let output: Line[] = [];
	let walk = (nodes: ChildNode[], depth: number): void => {
		for (let node of nodes) {
			if (
				node.type === "tag" ||
				node.type === "script" ||
				node.type === "style"
			) {
				output.push([
					depth,
					"element",
					node.name + " " + JSON.stringify(node.attribs),
				]);
				walk(node.children, depth + 1);
			} else if (node.type === "text") {
				let last = output.at(-1);
				if (last && last[0] === depth && last[1] === "text")
					last[2] += node.data;
				else output.push([depth, "text", node.data]);
			} else if (node.type === "comment") {
				output.push([depth, "comment", ""]);
			} else if (node.type === "directive") {
				output.push([depth, "directive", ""]);
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
		let kind = t.kind[id];
		if (kind === tree.ELEMENT) {
			output.push([
				d,
				"element",
				t.name[id] + " " + JSON.stringify(values.attributes(t, id)),
			]);
		} else if (kind === tree.TEXT) {
			let last = output.at(-1);
			if (last && last[0] === d && last[1] === "text")
				last[2] += values.value(t, id);
			else output.push([d, "text", values.value(t, id)]);
		} else {
			output.push([d, kind === tree.COMMENT ? "comment" : "directive", ""]);
		}
	}
	return output;
}

describe("build()", () => {
	for (let [name, html] of Object.entries(CASES)) {
		test(`matches htmlparser2 :: ${name}`, () => {
			expect(ours(html)).toEqual(theirs(html));
		});
	}

	test("element ranges point at their source", () => {
		for (let html of Object.values(CASES)) {
			let t = tree.build(html);
			for (let id = 1; id < t.kind.length; id++) {
				let outer = html.slice(t.start[id], t.end[id]);
				if (t.kind[id] === tree.ELEMENT) {
					expect(outer[0]).toBe("<");
					expect(t.start[id] <= t.from[id]).toBe(true);
					expect(t.from[id] <= t.to[id]).toBe(true);
					expect(t.to[id] <= t.end[id]).toBe(true);
				}
				if (t.kind[id] === tree.TEXT) {
					expect(outer).toBe(html.slice(t.from[id], t.to[id]));
				}
			}
		}
	});

	test("subtrees are contiguous", () => {
		for (let html of Object.values(CASES)) {
			let t = tree.build(html);
			for (let id = 1; id < t.kind.length; id++) {
				for (let x = id + 1; x < t.stop[id]; x++) {
					let p = t.parent[x];
					while (p > id) p = t.parent[p];
					expect(p).toBe(id);
				}
			}
		}
	});
});
