import { run } from "mitata";

import * as corpus from "./corpus";

const pages = await corpus.load();
const size = pages.reduce((sum, x) => sum + x.html.length, 0);
console.log(`${pages.length} pages, ${(size / 1e6).toFixed(2)} MB\n`);

await import("./parse");
await import("./query");
await import("./edit");

await run({ colors: false });
