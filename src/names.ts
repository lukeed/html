/** Known lowercase names in an open-addressed hash table. */
export type Table = (string | undefined)[];

const MASK = 511;

function lower(c: number): number {
	return c >= 65 && c <= 90 ? c + 32 : c;
}

function same(source: string, from: number, name: string): boolean {
	for (let i = 0; i < name.length; i++) {
		if (lower(source.charCodeAt(from + i)) !== name.charCodeAt(i)) return false;
	}
	return true;
}

/**
 * A {@link Table} of lowercase `names`, for {@link intern}.
 */
export function table(names: Iterable<string>): Table {
	let output: Table = new Array(MASK + 1).fill(undefined);
	for (let name of new Set(names)) {
		let h = 0;
		for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
		let k = h & MASK;
		while (output[k] !== undefined) k = (k + 1) & MASK;
		output[k] = name;
	}
	return output;
}

/**
 * The lowercase tag name in `source` from `from` to `to`. Names in `known`
 * return one shared string, so the parser makes no new string, and
 * lookups reuse its cached hash.
 * @example
 * intern(table(["div"]), "<DIV>", 1, 4); //=> "div"
 */
export function intern(
	known: Table,
	source: string,
	from: number,
	to: number,
): string {
	let h = 0;
	for (let i = from; i < to; i++)
		h = (h * 31 + lower(source.charCodeAt(i))) | 0;

	let length = to - from;
	for (let k = h & MASK; ; k = (k + 1) & MASK) {
		let name = known[k];
		if (name === undefined) return source.slice(from, to).toLowerCase();
		if (name.length === length && same(source, from, name)) return name;
	}
}
