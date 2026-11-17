import { expect, test } from "bun:test";
import { parse } from "./index";
import { build } from "./tree";
import { attributes, pairs } from "./values";

test("attribute caches are allocated independently on first read", () => {
	let t = build('<main><p CLASS=x class=y data-v="&amp;"></p><p></p></main>');
	expect(t.pairs).toBeUndefined();
	expect(t.attrs).toBeUndefined();
	let list = pairs(t, 2);
	expect(list).toEqual(["class", "x", "data-v", "&"]);
	expect(pairs(t, 2)).toBe(list);
	expect(t.pairs).toHaveLength(t.kind.length);
	expect(t.attrs).toBeUndefined();
	let record = attributes(t, 2);
	expect(record).toEqual({ class: "x", "data-v": "&" });
	expect(Object.isFrozen(record)).toBe(true);
	expect(attributes(t, 2)).toBe(record);
	expect(t.attrs).toHaveLength(t.kind.length);
	expect(attributes(t, 3)).toEqual({});
	expect(pairs(t, 3)).toEqual([]);
});

test("lazy wrappers preserve identity across navigation and queries", () => {
	let doc = parse("<main><p>x</p><p>y</p></main>");
	let first = doc.find("p")!;
	expect(doc.all("p")[0]).toBe(first);
	expect(doc.find("main")!.children[0]).toBe(first);
	expect(first.parent).toBe(doc.find("main")!);
	expect(doc.children[0]).toBe(doc.find("main")!);
});
