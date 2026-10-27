import * as tree from "./tree";
import * as values from "./values";

import type { Tree } from "./tree";

type Operator = "" | "=" | "~=" | "|=" | "^=" | "$=" | "*=";
type Combinator = " " | ">" | "+" | "~";

type Attribute = {
	name: string;
	operator: Operator;
	value: string;
	insensitive: boolean;
};

type Pseudo =
	| { kind: "root" | "empty" }
	| { kind: "nth"; a: number; b: number; last: boolean; type: boolean }
	| { kind: "not" | "is"; list: Selector };

type Compound = {
	/** Lowercased, for HTML elements. */
	tag: string;
	/** As written, for case-sensitive foreign elements like `clipPath`. */
	raw: string;
	id: string;
	classes: string[];
	attributes: Attribute[];
	pseudos: Pseudo[];
};

/** Compounds from left to right; `combinators[i]` joins `i - 1` and `i`. */
type Complex = {
	compounds: Compound[];
	combinators: Combinator[];
};

export type Selector = Complex[];

const OPERATORS: Operator[] = ["~=", "|=", "^=", "$=", "*=", "="];

const CACHE = new Map<string, Selector>();
const CACHE_LIMIT = 512;

const NTH: Record<string, [last: boolean, type: boolean]> = {
	"nth-child": [false, false],
	"nth-last-child": [true, false],
	"nth-of-type": [false, true],
	"nth-last-of-type": [true, true],
};

const EDGE: Record<
	string,
	[a: number, b: number, last: boolean, type: boolean][]
> = {
	"first-child": [[0, 1, false, false]],
	"last-child": [[0, 1, true, false]],
	"only-child": [
		[0, 1, false, false],
		[0, 1, true, false],
	],
	"first-of-type": [[0, 1, false, true]],
	"last-of-type": [[0, 1, true, true]],
	"only-of-type": [
		[0, 1, false, true],
		[0, 1, true, true],
	],
};

/**
 * Parse an `An+B` expression, like `2n+1`, `odd`, or `-n+3`.
 */
function nth(input: string): [a: number, b: number] {
	let expr = input.replace(/\s+/g, "").toLowerCase();
	if (expr === "odd") return [2, 1];
	if (expr === "even") return [2, 0];

	let match = /^([+-]?\d*)n([+-]\d+)?$|^([+-]?\d+)$/.exec(expr);
	if (!match) throw new SyntaxError(`Invalid nth expression: "${input}"`);
	if (match[3] != null) return [0, Number(match[3])];

	let a =
		match[1] === "" || match[1] === "+"
			? 1
			: match[1] === "-"
				? -1
				: Number(match[1]);
	return [a, Number(match[2] || 0)];
}

/**
 * Compile a selector list into matchers.
 * @throws {SyntaxError} for unsupported or malformed selectors.
 */
export function compile(input: string): Selector {
	let cached = CACHE.get(input);
	if (cached) return cached;

	let i = 0;
	let n = input.length;

	let fail = (reason: string): never => {
		throw new SyntaxError(`${reason} at ${i} in selector "${input}"`);
	};

	let spaces = (): boolean => {
		let from = i;
		while (i < n && /\s/.test(input[i])) i++;
		return i > from;
	};

	let ident = (): string => {
		let output = "";
		while (i < n) {
			let c = input[i];
			if (c === "\\") {
				let hex = /^[0-9a-fA-F]{1,6}\s?/.exec(input.slice(i + 1));
				if (hex) {
					output += String.fromCodePoint(parseInt(hex[0], 16));
					i += 1 + hex[0].length;
				} else {
					output += input[i + 1] ?? "";
					i += 2;
				}
			} else if (/[\w-]/.test(c) || c.charCodeAt(0) > 127) {
				output += c;
				i++;
			} else {
				break;
			}
		}
		if (!output) fail("Expected an identifier");
		return output;
	};

	let quoted = (): string => {
		let quote = input[i++];
		let output = "";
		while (i < n && input[i] !== quote) {
			if (input[i] === "\\") i++;
			output += input[i++] ?? "";
		}
		if (input[i] !== quote) fail("Unterminated string");
		i++;
		return output;
	};

	let attribute = (): Attribute => {
		i++;
		spaces();
		let name = ident().toLowerCase();
		spaces();

		let operator: Operator = "";
		let value = "";
		let insensitive = false;

		let op = OPERATORS.find((x) => input.startsWith(x, i));
		if (op) {
			operator = op;
			i += op.length;
			spaces();
			value = input[i] === '"' || input[i] === "'" ? quoted() : ident();
			spaces();
			if (/[is]/i.test(input[i] ?? "") && /[\s\]]/.test(input[i + 1] ?? "")) {
				insensitive = input[i].toLowerCase() === "i";
				i++;
				spaces();
			}
		}

		if (input[i] !== "]") fail('Expected "]"');
		i++;
		return { name, operator, value, insensitive };
	};

	let pseudo = (): Pseudo[] => {
		i++;
		let name = ident().toLowerCase();

		if (name === "root") return [{ kind: "root" }];
		if (name === "empty") return [{ kind: "empty" }];

		let edge = EDGE[name];
		if (edge)
			return edge.map(([a, b, last, type]) => ({
				kind: "nth",
				a,
				b,
				last,
				type,
			}));

		if (input[i] !== "(") fail(`Unsupported pseudo-class ":${name}"`);
		let depth = 1;
		let from = ++i;
		while (i < n && depth > 0) {
			if (input[i] === "(") depth++;
			else if (input[i] === ")") depth--;
			i++;
		}
		if (depth > 0) fail('Expected ")"');
		let args = input.slice(from, i - 1);

		let kind = NTH[name];
		if (kind) {
			let [a, b] = nth(args);
			return [{ kind: "nth", a, b, last: kind[0], type: kind[1] }];
		}

		if (name === "not") return [{ kind: "not", list: compile(args) }];
		if (name === "is" || name === "where")
			return [{ kind: "is", list: compile(args) }];

		return fail(`Unsupported pseudo-class ":${name}()"`);
	};

	let compound = (): Compound => {
		let output: Compound = {
			tag: "",
			raw: "",
			id: "",
			classes: [],
			attributes: [],
			pseudos: [],
		};
		let from = i;

		if (input[i] === "*") {
			i++;
		} else if (i < n && /[\w\\-]/.test(input[i])) {
			output.raw = ident();
			output.tag = output.raw.toLowerCase();
		}

		while (i < n) {
			let c = input[i];
			if (c === "#") {
				i++;
				output.id = ident();
			} else if (c === ".") {
				i++;
				output.classes.push(ident());
			} else if (c === "[") {
				output.attributes.push(attribute());
			} else if (c === ":") {
				output.pseudos.push(...pseudo());
			} else {
				break;
			}
		}

		if (i === from) fail("Expected a selector");
		return output;
	};

	let list: Selector = [];

	while (true) {
		spaces();
		let complex: Complex = { compounds: [compound()], combinators: [] };

		while (true) {
			let space = spaces();
			let c = input[i];
			if (i >= n || c === ",") break;

			let combinator: Combinator = " ";
			if (c === ">" || c === "+" || c === "~") {
				combinator = c;
				i++;
				spaces();
			} else if (!space) {
				fail(`Unexpected "${c}"`);
			}

			complex.combinators.push(combinator);
			complex.compounds.push(compound());
		}

		list.push(complex);
		if (i >= n) break;
		i++;
	}

	if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
	CACHE.set(input, list);
	return list;
}

/**
 * How the engine reads a tree. `C` is shared context, `N` a node handle.
 * Only elements are ever passed in.
 */
export type Adapter<C, N> = {
	name(c: C, n: N): string;
	attr(c: C, n: N, key: string): string | undefined;
	/** The parent element, or `undefined` at the top level. */
	parent(c: C, n: N): N | undefined;
	/** Element siblings, including `n`, in order. */
	siblings(c: C, n: N): N[];
	/** Whether `n` has no element or text children. */
	empty(c: C, n: N): boolean;
};

export type Matcher<C, N> = (c: C, n: N, list: Selector) => boolean;

/**
 * Create a selector matcher for one kind of tree.
 * Each call returns new closures, so each tree kind keeps its own inline caches.
 */
export function engine<C, N>(adapter: Adapter<C, N>): Matcher<C, N> {
	let attribute = (c: C, n: N, rule: Attribute): boolean => {
		let found = adapter.attr(c, n, rule.name);
		if (found === undefined) return false;
		if (rule.operator === "") return true;

		let actual = rule.insensitive ? found.toLowerCase() : found;
		let expected = rule.insensitive ? rule.value.toLowerCase() : rule.value;

		switch (rule.operator) {
			case "=":
				return actual === expected;
			case "~=":
				return (
					expected !== "" &&
					!/\s/.test(expected) &&
					actual.split(/\s+/).includes(expected)
				);
			case "|=":
				return actual === expected || actual.startsWith(expected + "-");
			case "^=":
				return expected !== "" && actual.startsWith(expected);
			case "$=":
				return expected !== "" && actual.endsWith(expected);
			case "*=":
				return expected !== "" && actual.includes(expected);
		}
	};

	let pseudo = (c: C, n: N, rule: Pseudo): boolean => {
		switch (rule.kind) {
			case "root":
				return adapter.parent(c, n) === undefined;
			case "empty":
				return adapter.empty(c, n);
			case "not":
				return !matches(c, n, rule.list);
			case "is":
				return matches(c, n, rule.list);
			case "nth": {
				let list = adapter.siblings(c, n);
				if (rule.type) {
					let name = adapter.name(c, n);
					list = list.filter((x) => adapter.name(c, x) === name);
				}
				let at = list.indexOf(n);
				let index = rule.last ? list.length - at : at + 1;
				if (rule.a === 0) return index === rule.b;
				let k = (index - rule.b) / rule.a;
				return k >= 0 && Number.isInteger(k);
			}
		}
	};

	let compound = (c: C, n: N, rule: Compound): boolean => {
		if (rule.tag) {
			let name = adapter.name(c, n);
			if (name !== rule.tag && name !== rule.raw) return false;
		}

		if (rule.id && adapter.attr(c, n, "id") !== rule.id) return false;

		if (rule.classes.length > 0) {
			let names = (adapter.attr(c, n, "class") ?? "").split(/\s+/);
			for (let name of rule.classes) if (!names.includes(name)) return false;
		}

		for (let x of rule.attributes) if (!attribute(c, n, x)) return false;
		for (let x of rule.pseudos) if (!pseudo(c, n, x)) return false;
		return true;
	};

	let complex = (c: C, n: N, rule: Complex, index: number): boolean => {
		if (!compound(c, n, rule.compounds[index])) return false;
		if (index === 0) return true;

		let combinator = rule.combinators[index - 1];

		if (combinator === ">") {
			let p = adapter.parent(c, n);
			return p !== undefined && complex(c, p, rule, index - 1);
		}

		if (combinator === " ") {
			for (
				let p = adapter.parent(c, n);
				p !== undefined;
				p = adapter.parent(c, p)
			) {
				if (complex(c, p, rule, index - 1)) return true;
			}
			return false;
		}

		let list = adapter.siblings(c, n);
		let at = list.indexOf(n);

		if (combinator === "+")
			return at > 0 && complex(c, list[at - 1], rule, index - 1);

		for (let x = at - 1; x >= 0; x--) {
			if (complex(c, list[x], rule, index - 1)) return true;
		}
		return false;
	};

	let matches: Matcher<C, N> = (c, n, list) => {
		for (let rule of list) {
			if (complex(c, n, rule, rule.compounds.length - 1)) return true;
		}
		return false;
	};

	return matches;
}

/**
 * Whether element `id` matches any selector in `list`.
 */
export const matches: Matcher<Tree, number> = engine<Tree, number>({
	name: (t, id) => t.name[id],
	attr: values.attribute,
	parent(t, id) {
		let p = t.parent[id];
		return p > 0 ? p : undefined;
	},
	siblings(t, id) {
		let p = t.parent[id];
		let output: number[] = [];
		for (let x = p + 1; x < t.stop[p]; x = t.stop[x]) {
			if (t.kind[x] === tree.ELEMENT) output.push(x);
		}
		return output;
	},
	empty(t, id) {
		for (let x = id + 1; x < t.stop[id]; x = t.stop[x]) {
			if (t.kind[x] === tree.ELEMENT || t.kind[x] === tree.TEXT) return false;
		}
		return true;
	},
});

/**
 * Candidate element ids for `list`, in source order: only ids with a
 * matching tag when every selector names one, else `undefined`.
 */
function candidates(t: Tree, list: Selector): number[] | undefined {
	let names = new Set<string>();
	for (let rule of list) {
		let last = rule.compounds[rule.compounds.length - 1];
		if (!last.tag) return;
		names.add(last.tag);
		names.add(last.raw);
	}

	if (!t.tags) {
		t.tags = new Map();
		for (let id = 1; id < t.kind.length; id++) {
			if (t.kind[id] !== tree.ELEMENT) continue;
			let found = t.tags.get(t.name[id]);
			if (found) found.push(id);
			else t.tags.set(t.name[id], [id]);
		}
	}

	let output: number[] = [];
	for (let name of names) output = output.concat(t.tags.get(name) ?? []);
	return names.size > 1 ? output.sort((a, b) => a - b) : output;
}

/**
 * Element ids inside `root` that match `list`, in source order.
 * Stops after `limit` matches.
 */
export function all(
	t: Tree,
	root: number,
	list: Selector,
	limit = Infinity,
): number[] {
	let output: number[] = [];
	let stop = t.stop[root];
	let ids = candidates(t, list);

	if (ids) {
		for (let id of ids) {
			if (id <= root) continue;
			if (id >= stop) break;
			if (matches(t, id, list)) {
				output.push(id);
				if (output.length >= limit) break;
			}
		}
		return output;
	}

	for (let id = root + 1; id < stop; id++) {
		if (t.kind[id] === tree.ELEMENT && matches(t, id, list)) {
			output.push(id);
			if (output.length >= limit) break;
		}
	}
	return output;
}
