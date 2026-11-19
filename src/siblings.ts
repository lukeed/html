import * as tree from "./tree";

import type { Tree } from "./tree";

/**
 * Element sibling positions, by node id, filled one family at a time.
 * `index` is 0 until the family of that id is filled.
 */
export type Ranks = {
	previous: Uint16Array | Int32Array;
	index: Uint16Array | Int32Array;
	count: Uint16Array | Int32Array;
	typeIndex: Uint16Array | Int32Array;
	typeCount: Uint16Array | Int32Array;
};

/**
 * The {@link Ranks} of `t`, with the family of element `id` filled.
 * @example
 * siblings.ranks(t, id).previous[id]; //=> the previous element sibling, or 0
 */
export function ranks(t: Tree, id: number): Ranks {
	let output = t.ranks;
	if (!output) {
		let n = t.kind.length;
		let Column = n < 0x10000 ? Uint16Array : Int32Array;
		output = t.ranks = {
			previous: new Column(n),
			index: new Column(n),
			count: new Column(n),
			typeIndex: new Column(n),
			typeCount: new Column(n),
		};
	}
	if (output.index[id] !== 0) return output;

	let parent = t.parent[id];
	let stop = t.stop[parent];
	let counts = new Map<string, number>();
	let previous = 0;
	let count = 0;
	for (let x = parent + 1; x < stop; x = t.stop[x]) {
		if (t.kind[x] !== tree.ELEMENT) continue;
		let typeIndex = (counts.get(t.name[x]) ?? 0) + 1;
		counts.set(t.name[x], typeIndex);
		output.previous[x] = previous;
		output.index[x] = ++count;
		output.typeIndex[x] = typeIndex;
		previous = x;
	}
	for (let x = parent + 1; x < stop; x = t.stop[x]) {
		if (t.kind[x] !== tree.ELEMENT) continue;
		output.count[x] = count;
		output.typeCount[x] = counts.get(t.name[x])!;
	}
	return output;
}

/**
 * The 1-based position of element `id` among its element siblings, or among
 * those of its type, counted from the end when `last` is set.
 * @example
 * siblings.position(tree.build("<p></p><p></p>"), 2, false, false); //=> 2
 */
export function position(
	t: Tree,
	id: number,
	last: boolean,
	type: boolean,
): number {
	let r = ranks(t, id);
	let at = type ? r.typeIndex[id] : r.index[id];
	let count = type ? r.typeCount[id] : r.count[id];
	return last ? count - at + 1 : at;
}
