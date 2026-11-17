import { describe, expect, test } from "bun:test";
import * as mutable from "./index";
import { unwrap } from "./node";
import type { State } from "./state";

describe("mutable sibling queries", () => {
	test("single structural matches and closest agree with queries after edits", () => {
		let doc = mutable.parse(
			"<ul><li>1<!--c--><li>2</li>text<p>3<li>4<p>5<li>6</ul>",
		);
		let ul = doc.find("ul")!;
		let selectors = [
			"li:nth-child(odd)",
			"li:nth-last-child(2)",
			"li:nth-of-type(2n)",
			"p:last-of-type",
			":only-of-type",
			"li + p",
			"li ~ p",
			"p ~ li + li",
			":is(p, li):not(:first-child)",
			"li ~ li ~ li",
			":not(p + li) ~ li",
			":is(li + p) ~ li",
			"li:nth-child(2) ~ li + li",
			"p ~ li:nth-last-child(2) ~ *",
		];
		let check = () => {
			for (let selector of selectors) {
				let found = doc.all(selector);
				for (let el of doc.all("*")) {
					expect(el.matches(selector)).toBe(found.includes(el));
					expect(el.closest(selector)).toBe(
						[el, ...ancestors(el)].find((x) => found.includes(x)),
					);
				}
			}
		};
		let ancestors = (el: mutable.Element) => {
			let output: mutable.Element[] = [];
			for (let p = el.parent; p && p.type === "element"; p = p.parent)
				output.push(p);
			return output;
		};
		check();
		ul.children[0].remove();
		check();
		ul.append(doc.find("p")!);
		check();
		ul.prepend(doc.all("li")[2].clone());
		doc.all("li")[1].name = "p";
		check();
	});

	test("single structural matches read each sibling a bounded number of times", () => {
		// Nested `+`/`~` and positions inside `~` must not rescan siblings per candidate.
		let doc = mutable.parse(
			`<section><p></p><ul>${"<li></li>text".repeat(2000)}</ul></section>`,
		);
		let last = doc.all("li").at(-1)!;
		let list = unwrap(doc.find("ul")!).children!;
		let reads = 0;
		for (let s of list) {
			let kind = s.kind;
			Object.defineProperty(s, "kind", { get: () => (reads++, kind) });
		}
		let indexOf = list.indexOf;
		list.indexOf = function (x: State) {
			let i = indexOf.call(this, x);
			reads += i + 1;
			return i;
		};
		let cases: [string, boolean][] = [
			["a + li ~ li", false],
			[":is(a + li) ~ li", false],
			[":not(a + li + li) ~ p", false],
			[":nth-child(1) ~ li", true],
			["li:last-child ~ li", false],
			[":nth-last-of-type(9) ~ li", true],
			[":first-child + ul li ~ li", true],
			["a ~ li, p + li", false],
			["li ~ li", true],
		];
		for (let [selector, expected] of cases) {
			reads = 0;
			expect(last.matches(selector)).toBe(expected);
			expect(reads).toBeLessThan(8 * list.length);
		}
	});

	test("single structural matches rank each family once in descendant chains", () => {
		let doc = mutable.parse(
			("<div>" + "<b></b>".repeat(100)).repeat(30) + "</div>".repeat(30),
		);
		let last = doc.all("div").at(-1)!;
		let families = doc.all("div").map((x) => unwrap(x).parent!.children!);
		let reads = 0;
		for (let s of families.flat()) {
			let kind = s.kind;
			Object.defineProperty(s, "kind", { get: () => (reads++, kind) });
		}
		expect(last.matches(":nth-last-child(3) * *")).toBe(false);
		expect(reads).toBeLessThan(8 * families.flat().length);
	});

	test("single structural matches rank a family checked again by backtracking", () => {
		let doc = mutable.parse(
			`<main>${"<b></b>".repeat(500)}<section>${"<i>".repeat(200)}</section></main>`,
		);
		let last = doc.all("i").at(-1)!;
		let reads = 0;
		for (let s of unwrap(doc.find("main")!).children!.slice(0, -1)) {
			let kind = s.kind;
			Object.defineProperty(s, "kind", { get: () => (reads++, kind) });
		}
		expect(last.matches("section:nth-last-child(2) * *")).toBe(false);
		expect(reads).toBeLessThan(4 * 500);
	});
});
