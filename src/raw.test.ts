import { expect, test } from "bun:test";
import { parse } from "./index";

test("raw-text closing compares ASCII case without accepting prefixes", () => {
	for (let name of ["script", "style", "title", "textarea"]) {
		let doc = parse(
			`<${name}>a</${name}x>b</${name.toUpperCase()} ><p>end</p>`,
		);
		expect(doc.find(name)!.text).toBe(`a</${name}x>b`);
		expect(doc.find("p")!.text).toBe("end");
	}
});
