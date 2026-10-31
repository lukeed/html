import { describe, expect, test } from "bun:test";

import * as tree from "./tree";
import * as values from "./values";

const HEADS = [
	"",
	" a",
	" A=1 a=2",
	` href="/x" title='y' data-z=z hidden`,
	" a = 1  b= '2'  c =\"3\"",
	" a=/x/",
	" a= ",
	" a=",
	` a="x>y" b`,
	` "a" 'b' c`,
	" a\tb\nc\fd\re",
	" =a b",
	" a/b c",
	` a=1"2 b`,
	" a=&amp;b c=&copy;",
	" İ=1 i=2",
	" \u212A=1 k=2",
	" ÄB=1 äb=2",
	` a="x" A="y" a='z'`,
	` a="<b>" c='>' d="'" e='"'`,
	` a="&quot;x&quot;" b=&lt;&gt; c="&amp;amp;"`,
	" a=b=c d==e",
	" a\u00a0b=1",
];

/** Keys to look up beyond the parsed ones: absent, mixed case, and special. */
const KEYS = [
	"",
	"x",
	"a=",
	"İ",
	"i̇",
	"k",
	"\u212A",
	"Ä",
	"__proto__",
	"constructor",
];

describe("spans", () => {
	test("finds the same attributes as pairs", () => {
		for (let head of HEADS) {
			for (let close of [">", "/>", " />"]) {
				let t = tree.build(`<x${head}${close}</x>`);
				let pairs = values.pairs(t, 1);
				let spans = values.spans(t, 1);
				let keys = (list: string[], stride: number) =>
					list.filter((_, i) => i % stride === 0);
				expect(keys(spans, 3)).toEqual(keys(pairs, 2));
				for (let i = 0; i < spans.length; i += 3) {
					expect(t.source).toContain(spans[i + 2]);
					expect(spans[i + 2].startsWith(spans[i + 1])).toBe(true);
				}
			}
		}
	});
});

describe("lookup", () => {
	test("finds the same values as pairs, parsed or not", () => {
		let sources = HEADS.flatMap((head) =>
			[">", "/>", " />"].map((close) => `<x${head}${close}</x>`),
		);
		for (let html of [...sources, "</br></p>"]) {
			let parsed = tree.build(html);
			let fresh = tree.build(html);
			for (let id = 1; id < parsed.kind.length; id++) {
				if (parsed.kind[id] !== tree.ELEMENT) continue;
				let keys = values.pairs(parsed, id).filter((_, i) => i % 2 === 0);
				let upper = keys.map((x) => x.toUpperCase());
				for (let key of [...keys, ...upper, ...KEYS]) {
					let expected = values.attribute(parsed, id, key);
					expect(values.lookup(fresh, id, key)).toBe(expected);
					expect(values.lookup(parsed, id, key)).toBe(expected);
				}
				expect(fresh.pairs[id]).toBeUndefined();
			}
		}
	});
});
