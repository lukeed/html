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
