export type Input = {
	html: string;
	bytes: Uint8Array;
};

export type Candidate = {
	name: string;
	/** Run the workload on every page and return what a caller would keep. */
	run(inputs: Input[]): unknown;
};

export type Suite = {
	id: string;
	title: string;
	/** What the workload does, for bench/readme.md. */
	about: string;
	candidates: Candidate[];
};

/** Whether Bun's native HTMLRewriter is available. */
export const REWRITER = typeof HTMLRewriter !== "undefined";
