# @lukeed/html

> A fast HTML parser with source offsets and CSS selectors

- **Fast:** builds a full tree at about 400 MB/s, 2–4x faster than other JavaScript parsers.
- **Lazy:** attributes and text are parsed and entity-decoded only when you read them.
- **Located:** every node has `start` and `end` source offsets; `document.position()` maps them to lines and columns.
- **Lossless:** `stringify()` returns the source exactly as written.
- **Familiar:** the tree matches htmlparser2, and selectors match css-select.

## Install

```sh
$ bun add @lukeed/html
```

## Usage

```ts
import { parse, stringify } from "@lukeed/html";

let doc = parse(
  `<head><title>Hi &amp; bye</title><link rel="canonical" href="/"></head>`,
);

doc.find("head > title")?.text; //=> "Hi & bye"
doc.find("link[rel=canonical]")?.getAttr("href"); //=> "/"

for (let img of doc.all("img:not([alt])")) {
  let { line, column } = doc.position(img.start);
  console.log(`${line}:${column}`, stringify(img));
}
```

## API

### parse(source: string): Document

Parse HTML. It never throws. Malformed HTML is recovered the same way htmlparser2 recovers it.

### stringify(node: Node | Document): string

Return the source of a node or document, exactly as written.

### Document

- `source`, `start`, `end`, `children`
- `find(selector)` and `all(selector)`
- `position(offset)` returns `{ line, column }`, both 1-based.

### Element

- `name`, `start`, `end`, `parent`, `children`, `document`
- `attributes` is a frozen object with lowercase names and decoded values.
- `getAttr(name)` and `hasAttr(name)` ignore the case of `name`.
- `text` is the decoded text of all descendants. `html` is the inner source.
- `find(selector)`, `all(selector)`, `matches(selector)`, `closest(selector)`

### Text, Comment, Directive

- `value`, `start`, `end`, `parent`, `document`

The same node always returns the same object, so `===` works.

### Selectors

Supported: type, `*`, `#id`, `.class`, attributes with `=`, `~=`, `|=`, `^=`, `$=`, `*=` and the `i` and `s` flags, the combinators ` `, `>`, `+`, `~`, selector lists, and the pseudo-classes `:root`, `:empty`, `:first-child`, `:last-child`, `:only-child`, `:nth-child()`, `:nth-last-child()`, `:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-of-type()`, `:nth-last-of-type()`, `:not()`, `:is()`, and `:where()`.

An unsupported or malformed selector throws a `SyntaxError`.

## Mutable variant

`@lukeed/html/mutable` has the same API, plus edits. Choose it only when you need to change the document; it parses a little slower and uses more memory.

```ts
import { parse, stringify } from "@lukeed/html/mutable";

let doc = parse("<ul><li>a</li></ul>");
doc.find("li")?.setAttr("class", "first");
doc.find("ul")?.append(...parse("<li>b</li>").children);
stringify(doc); //=> '<ul><li class="first">a</li><li>b</li></ul>'
```

- `Element`: `setAttr(name, value)`, `removeAttr(name)`, the `text` and `html` setters, `append()`, `prepend()`
- `Element`, `Text`, `Comment`, `Directive`: `before()`, `after()`, `replace()`, `remove()`
- `Text`, `Comment`, `Directive`: the `value` setter
- `Document`: `append()`, `prepend()`

Insert methods take nodes or strings. Strings are inserted as text, not HTML; use the `html` setter or `parse(html).children` for HTML. Nodes move from wherever they are, including from another document.

Reads and selectors see every edit. `stringify()` copies unedited parts from the source as written, and rebuilds only edited parts, with values escaped. `start` and `end` always refer to the original `document.source`; they are `undefined` for nodes that were not parsed from it.

## Not a sanitizer

The tree follows htmlparser2, not the WHATWG tree construction algorithm. Browsers can build a different tree from the same malformed markup. Do not use this package to decide if HTML is safe to render.

## Benchmarks

<!-- bench:start -->

> Bun 1.4.4 and Node v26.12.1 on Apple M1 Max, 2026-10-27. 12 real pages, 4.79 MB in total. Memory is retained heap on Node. See [`bench/readme.md`](bench/readme.md) for details.

```
Benchmark :: parse (4.79 MB)    Bun       Node       Memory
  @lukeed/html                  11.8ms    12.5ms     5.5MB
  @lukeed/html, read all        30.1ms    45.9ms     17.5MB
  @lukeed/html/mutable          14.0ms    26.1ms     22.1MB
  ultrahtml                     25.4ms    54.4ms     25.8MB
  htmlparser2                   42.6ms    106.2ms    19.9MB
  node-html-parser              44.3ms    75.3ms     40.1MB
  parse5                        86.6ms    295.4ms    108.9MB
  Bun HTMLRewriter → tree       44.8ms    –          –

Benchmark :: parse + query (4.79 MB)      Bun       Node
  @lukeed/html                            18.2ms    22.3ms
  @lukeed/html/mutable                    24.2ms    28.5ms
  lol-html (wasm), streaming              19.7ms    24.1ms
  ultrahtml + selector                    30.4ms    60.9ms
  htmlparser2 + css-select                54.7ms    101.9ms
  node-html-parser                        53.3ms    93.2ms
  Bun HTMLRewriter (native), streaming    9.8ms     –

Benchmark :: parse + stringify (4.79 MB)    Bun       Node
  @lukeed/html/mutable                      13.7ms    15.2ms
  ultrahtml                                 41.5ms    80.4ms
  htmlparser2 + dom-serializer              57.3ms    116.7ms
  node-html-parser                          49.6ms    78.5ms

Benchmark :: parse + edit + stringify (4.79 MB)    Bun       Node
  @lukeed/html/mutable                             33.4ms    44.1ms
  lol-html (wasm), streaming                       47.9ms    63.8ms
  ultrahtml + selector                             45.5ms    84.7ms
  htmlparser2 + css-select + dom-serializer        63.8ms    153.7ms
  node-html-parser                                 65.2ms    111.3ms
  Bun HTMLRewriter (native), streaming             10.4ms    –
```

<!-- bench:end -->

## License

MIT © [Luke Edwards](https://lukeed.com)
