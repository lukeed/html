import * as tree from "./tree";
import type { Tree } from "./tree";

/** Query-local sibling metadata for mutable states. */
export type Rank<N> = {
	previous: N | undefined;
	index: number;
	count: number;
	typeIndex: number;
	typeCount: number;
};

/** Index one sibling family in two linear passes, including exact-case type ranks. */
export function index<C, N>(
	cache: Map<N, Rank<N>>,
	c: C,
	nodes: N[],
	name: (c: C, n: N) => string,
): void {
	let counts = new Map<string, number>();
	let previous: N | undefined;
	for (let i = 0; i < nodes.length; i++) {
		let n = nodes[i];
		let type = name(c, n);
		let typeIndex = (counts.get(type) ?? 0) + 1;
		counts.set(type, typeIndex);
		cache.set(n, {
			previous,
			index: i + 1,
			count: nodes.length,
			typeIndex,
			typeCount: 0,
		});
		previous = n;
	}
	for (let n of nodes) cache.get(n)!.typeCount = counts.get(name(c, n))!;
}

/**
 * Five compact columns, with no retained object or Map entry per node. Ids
 * and positions are below the node count, so most trees need only 16 bits.
 */
type Columns = {
	previous: Uint16Array | Int32Array;
	index: Uint16Array | Int32Array;
	count: Uint16Array | Int32Array;
	typeIndex: Uint16Array | Int32Array;
	typeCount: Uint16Array | Int32Array;
};

const columns = new WeakMap<Tree, Columns>();

/** Allocate on the first structural lookup; populate only the requested family. */
export function immutable(t: Tree, id: number): Columns {
	let ranks = columns.get(t);
	if (!ranks) {
		let n = t.kind.length;
		let Column = n < 0x10000 ? Uint16Array : Int32Array;
		columns.set(
			t,
			(ranks = {
				previous: new Column(n),
				index: new Column(n),
				count: new Column(n),
				typeIndex: new Column(n),
				typeCount: new Column(n),
			}),
		);
	}
	if (ranks.index[id] !== 0) return ranks;

	let parent = t.parent[id];
	let stop = t.stop[parent];
	let counts = new Map<string, number>();
	let previous = 0;
	let count = 0;
	for (let x = parent + 1; x < stop; x = t.stop[x]) {
		if (t.kind[x] !== tree.ELEMENT) continue;
		let name = t.name[x];
		let typeIndex = (counts.get(name) ?? 0) + 1;
		counts.set(name, typeIndex);
		ranks.previous[x] = previous;
		ranks.index[x] = ++count;
		ranks.typeIndex[x] = typeIndex;
		previous = x;
	}
	for (let x = parent + 1; x < stop; x = t.stop[x]) {
		if (t.kind[x] !== tree.ELEMENT) continue;
		ranks.count[x] = count;
		ranks.typeCount[x] = counts.get(t.name[x])!;
	}
	return ranks;
}

/** Position of `id` from the {@link immutable} columns. */
export function indexed(
	t: Tree,
	id: number,
	last: boolean,
	type: boolean,
): number {
	let ranks = immutable(t, id);
	let at = type ? ranks.typeIndex[id] : ranks.index[id];
	let count = type ? ranks.typeCount[id] : ranks.count[id];
	return last ? count - at + 1 : at;
}
