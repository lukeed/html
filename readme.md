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
doc.find("link[rel=canonical]")?.attr("href"); //=> "/"

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
- `attr(name)` and `has(name)` ignore the case of `name`.
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
doc.find("li")?.set("class", "first");
doc.find("ul")?.append(...parse("<li>b</li>").children);
stringify(doc); //=> '<ul><li class="first">a</li><li>b</li></ul>'
```

- `Element`: `set(name, value)`, `unset(name)`, the `text` and `html` setters, `append()`, `prepend()`
- `Element`, `Text`, `Comment`, `Directive`: `before()`, `after()`, `replace()`, `remove()`
- `Text`, `Comment`, `Directive`: the `value` setter
- `Document`: `append()`, `prepend()`

Insert methods take nodes or strings. Strings are inserted as text, not HTML; use the `html` setter or `parse(html).children` for HTML. Nodes move from wherever they are, including from another document.

Reads and selectors see every edit. `stringify()` copies unedited parts from the source as written, and rebuilds only edited parts, with values escaped. `start` and `end` always refer to the original `document.source`; they are `undefined` for nodes that were not parsed from it.

## Not a sanitizer

The tree follows htmlparser2, not the WHATWG tree construction algorithm. Browsers can build a different tree from the same malformed markup. Do not use this package to decide if HTML is safe to render.

## Benchmarks

12 real pages, 4.79 MB in total. Run `bun run corpus` once, then `bun run bench` or `bun run bench:node`. Each iteration starts with a collected heap.

| Full tree                                   | Bun 1.4.4   | Node 26     |
| ------------------------------------------- | ----------- | ----------- |
| **@lukeed/html**                            | **11.5 ms** | **12.6 ms** |
| @lukeed/html/mutable                        | 14.4 ms     | 14.3 ms     |
| @lukeed/html, every attribute and text read | 30.2 ms     | 36.0 ms     |
| ultrahtml                                   | 25.8 ms     | 39.6 ms     |
| htmlparser2                                 | 39.7 ms     | 67.7 ms     |
| node-html-parser                            | 41.1 ms     | 45.6 ms     |
| parse5                                      | 82.1 ms     | 216.4 ms    |
| Bun HTMLRewriter, building a tree           | 42.6 ms     | –           |

| Parse, then query title, meta, canonical, links, and images | Bun 1.4.4   | Node 26     |
| ----------------------------------------------------------- | ----------- | ----------- |
| **@lukeed/html**                                            | **18.1 ms** | **20.7 ms** |
| @lukeed/html/mutable                                        | 24.5 ms     | 27.4 ms     |
| lol-html (WASM), streaming                                  | 20.5 ms     | 24.0 ms     |
| ultrahtml + selector                                        | 30.9 ms     | 60.5 ms     |
| htmlparser2 + css-select                                    | 50.6 ms     | 107.0 ms    |
| node-html-parser                                            | 55.3 ms     | 79.8 ms     |
| Bun HTMLRewriter (native), streaming                        | 9.5 ms      | –           |

| Parse, then stringify with no edits | Bun 1.4.4   | Node 26     |
| ----------------------------------- | ----------- | ----------- |
| **@lukeed/html/mutable**            | **13.5 ms** | **14.5 ms** |
| ultrahtml                           | 46.8 ms     | 62.6 ms     |
| node-html-parser                    | 49.5 ms     | 70.7 ms     |
| htmlparser2 + dom-serializer        | 53.5 ms     | 116.2 ms    |

| Parse, set link `rel`, add missing image `alt`, set title text, then stringify | Bun 1.4.4   | Node 26     |
| ------------------------------------------------------------------------------ | ----------- | ----------- |
| **@lukeed/html/mutable**                                                       | **33.2 ms** | **35.9 ms** |
| ultrahtml + selector                                                           | 45.1 ms     | 76.6 ms     |
| lol-html (WASM), streaming                                                     | 52.9 ms     | 61.6 ms     |
| htmlparser2 + css-select + dom-serializer                                      | 59.7 ms     | 126.8 ms    |
| node-html-parser                                                               | 66.3 ms     | 93.0 ms     |
| Bun HTMLRewriter (native), streaming                                           | 9.9 ms      | –           |

`bun run compare` checks every tree in the corpus, node by node, against htmlparser2. It also applies the edit workload with the mutable variant, then parses the output again to check it.

## License

MIT © [Luke Edwards](https://lukeed.com)
