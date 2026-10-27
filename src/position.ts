/** A 1-based source location. */
export type Position = {
	line: number;
	column: number;
};

/**
 * Offsets of every line break in `source`.
 */
export function breaks(source: string): number[] {
	let output: number[] = [];
	for (
		let i = source.indexOf("\n");
		i !== -1;
		i = source.indexOf("\n", i + 1)
	) {
		output.push(i);
	}
	return output;
}

/**
 * Convert `offset` to a {@link Position}, given the line `breaks` of its source.
 */
export function locate(lines: number[], offset: number): Position {
	let lo = 0;
	let hi = lines.length;
	while (lo < hi) {
		let mid = (lo + hi) >>> 1;
		if (lines[mid] < offset) lo = mid + 1;
		else hi = mid;
	}
	return {
		line: lo + 1,
		column: offset - (lo > 0 ? lines[lo - 1] + 1 : 0) + 1,
	};
}
