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

> **Size (gzip):** 6.3 kB, or 21.8 kB with `entities`

#### `@lukeed/html/mutable`

> **Size (gzip):** 8.8 kB, or 24.1 kB with `entities`

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
- `text` is the decoded text of all text nodes.
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

- `Element`: `setAttr(name, value)`, `removeAttr(name)`, the `name`, `text`, and `html` setters, `append()`, `prepend()`
- `Element`, `Text`, `Comment`, `Directive`: `before()`, `after()`, `replace()`, `remove()`, `clone()`
- `Text`, `Comment`, `Directive`: the `value` setter
- `Document`: `append()`, `prepend()`

`clone()` returns a deep copy with no parent, in the same document. It keeps the `start` and `end` of the original.

Insert methods take nodes or strings. Strings are inserted as text, not HTML; use the `html` setter or `parse(html).children` for HTML. The `html` setter parses in the context of the element, so `<path/>` inside `<svg>` is self-closing. `parse()` always starts in an HTML context. Nodes move from wherever they are, including from another document.

Reads and selectors see every edit. `stringify()` copies unedited parts from the source as written, and rebuilds only edited parts, with values escaped. In a rebuilt tag, unedited attributes are copied as written, and edited attributes keep their name as written, like `viewBox`. A new attribute is written as given to `setAttr()`. `start` and `end` always refer to the original `document.source`; they are `undefined` for nodes that were not parsed from it.

## Not a sanitizer

The tree follows htmlparser2, not the WHATWG tree construction algorithm. Browsers can build a different tree from the same malformed markup. Do not use this package to decide if HTML is safe to render.

## Benchmarks

<!-- bench:start -->

> Bun 1.4.4 and Node v26.12.1 on Apple M1 Max, 2026-10-29. 12 real pages, 4.79 MB in total. Memory is retained heap on Node. See [`bench/readme.md`](bench/readme.md) for details.

```txt
Benchmark :: parse (4.79 MB)    Bun       Node       Memory
  @lukeed/html                   7.9ms     11.5ms      4.9MB
  @lukeed/html, read all        25.0ms     34.8ms     21.1MB
  @lukeed/html/mutable          10.3ms     13.0ms     21.0MB
  ultrahtml                     25.8ms     39.8ms     25.8MB
  htmlparser2                   40.9ms     66.1ms     19.9MB
  node-html-parser              44.0ms     50.6ms     40.1MB
  parse5                        86.7ms    203.9ms    108.9MB
  Bun HTMLRewriter → tree       45.7ms    –          –

Benchmark :: parse + query (4.79 MB)      Bun       Node
  @lukeed/html                            11.8ms    16.0ms
  @lukeed/html/mutable                    19.9ms    24.1ms
  lol-html (wasm), streaming              19.7ms    23.5ms
  ultrahtml + selector                    30.4ms    60.7ms
  htmlparser2 + css-select                52.8ms    96.9ms
  node-html-parser                        53.3ms    77.9ms
  Bun HTMLRewriter (native), streaming     9.8ms    –

Benchmark :: parse + stringify (4.79 MB)    Bun       Node
  @lukeed/html/mutable                      10.5ms     13.5ms
  ultrahtml                                 41.3ms     66.2ms
  htmlparser2 + dom-serializer              56.1ms    111.1ms
  node-html-parser                          48.4ms     68.3ms

Benchmark :: parse + edit + stringify (4.79 MB)    Bun       Node
  @lukeed/html/mutable                             20.7ms     28.3ms
  lol-html (wasm), streaming                       47.3ms     59.3ms
  ultrahtml + selector                             44.8ms     76.5ms
  htmlparser2 + css-select + dom-serializer        61.7ms    121.1ms
  node-html-parser                                 63.5ms     91.6ms
  Bun HTMLRewriter (native), streaming              9.7ms     –
```

<!-- bench:end -->

## License

MIT © [Luke Edwards](https://lukeed.com)
