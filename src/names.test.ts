import { describe, expect, test } from "bun:test";

import * as names from "./names";

const KNOWN = names.table(["div", "foreignobject", "h1", "di"]);

function intern(source: string, from: number, to: number): string {
	return names.intern(KNOWN, source, from, to);
}

describe("intern()", () => {
	test("should lowercase known names", () => {
		expect(intern("<DIV>", 1, 4)).toBe("div");
		expect(intern("<ForeignObject>", 1, 14)).toBe("foreignobject");
		expect(intern("<h1>", 1, 3)).toBe("h1");
	});

	test("should lowercase unknown names", () => {
		expect(intern("<My-Element>", 1, 11)).toBe("my-element");
		expect(intern("<divx>", 1, 5)).toBe("divx");
		expect(intern("<dir>", 1, 4)).toBe("dir");
	});

	test("should match non-ASCII names like toLowerCase()", () => {
		expect(intern("<Kbd>", 1, 4)).toBe("Kbd".toLowerCase());
		expect(intern("<ÄBC>", 1, 4)).toBe("äbc");
	});
});
