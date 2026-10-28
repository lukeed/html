# @lukeed/html

> A fast HTML parser with source offsets and CSS selectors

- **Fast:** builds a full tree at 400–600 MB/s, 3–6x faster than other JavaScript parsers.
- **Lazy:** attributes and text are parsed and entity-decoded only when you read them.
- **Located:** every node has `start` and `end` source offsets; `document.position()` maps them to lines and columns.
- **Lossless:** `stringify()` returns the source exactly as written.
- **Familiar:** the tree matches htmlparser2, and selectors match css-select.

## Install

```sh
$ bun add @lukeed/html
```

## Modes

There are two "versions" of `@lukeed/html` available:

<!-- modes:start -->

#### `@lukeed/html`

> **Size (gzip):** 5.9 kB, or 21.3 kB with `entities`

#### `@lukeed/html/mutable`

> **Size (gzip):** 7.1 kB, or 22.5 kB with `entities`

<!-- modes:end -->

|                        |       Parse        |     Selectors      |   Source offsets   |     Stringify      |  Edit attributes   | Edit text and children |
| ---------------------- | :----------------: | :----------------: | :----------------: | :----------------: | :----------------: | :--------------------: |
| `@lukeed/html`         | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |        :x:         |          :x:           |
| `@lukeed/html/mutable` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |   :white_check_mark:   |

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

Reads and selectors see every edit. `stringify()` copies unedited parts from the source as written, and rebuilds only edited parts, with values escaped. In a rebuilt tag, unedited attributes are copied as written, and edited attributes keep their name as written, like `viewBox`. A new attribute is written as given to `setAttr()`. `start` and `end` always refer to the original `document.source`; they are `undefined` for nodes that were not parsed from it.

## Not a sanitizer

The tree follows htmlparser2, not the WHATWG tree construction algorithm. Browsers can build a different tree from the same malformed markup. Do not use this package to decide if HTML is safe to render.

## Benchmarks

<!-- bench:start -->

> Bun 1.4.4 and Node v26.12.1 on Apple M1 Max, 2026-10-27. 12 real pages, 4.79 MB in total. Memory is retained heap on Node. See [`bench/readme.md`](bench/readme.md) for details.

```txt
Benchmark :: parse (4.79 MB)    Bun       Node       Memory
  @lukeed/html                  7.9ms     11.7ms     4.9MB
  @lukeed/html, read all        26.1ms    36.6ms     21.2MB
  @lukeed/html/mutable          10.3ms    13.1ms     20.9MB
  ultrahtml                     25.0ms    41.6ms     25.8MB
  htmlparser2                   40.4ms    68.2ms     19.9MB
  node-html-parser              44.0ms    50.7ms     40.1MB
  parse5                        86.4ms    213.6ms    108.9MB
  Bun HTMLRewriter → tree       46.2ms    –          –

Benchmark :: parse + query (4.79 MB)      Bun       Node
  @lukeed/html                            11.8ms    16.3ms
  @lukeed/html/mutable                    19.6ms    24.1ms
  lol-html (wasm), streaming              19.3ms    23.4ms
  ultrahtml + selector                    30.0ms    62.2ms
  htmlparser2 + css-select                52.5ms    104.2ms
  node-html-parser                        51.1ms    78.1ms
  Bun HTMLRewriter (native), streaming    9.3ms     –

Benchmark :: parse + stringify (4.79 MB)    Bun       Node
  @lukeed/html/mutable                      10.0ms    13.5ms
  ultrahtml                                 41.0ms    69.1ms
  htmlparser2 + dom-serializer              55.3ms    121.3ms
  node-html-parser                          47.6ms    68.1ms

Benchmark :: parse + edit + stringify (4.79 MB)    Bun       Node
  @lukeed/html/mutable                             27.8ms    35.5ms
  lol-html (wasm), streaming                       46.8ms    63.1ms
  ultrahtml + selector                             43.6ms    79.4ms
  htmlparser2 + css-select + dom-serializer        61.7ms    131.3ms
  node-html-parser                                 60.1ms    95.5ms
  Bun HTMLRewriter (native), streaming             9.5ms     –
```

<!-- bench:end -->

## License

MIT © [Luke Edwards](https://lukeed.com)
