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

## Not a sanitizer

The tree follows htmlparser2, not the WHATWG tree construction algorithm. Browsers can build a different tree from the same malformed markup. Do not use this package to decide if HTML is safe to render.

## Benchmarks

12 real pages, 4.79 MB in total. Run `bun run corpus` once, then `bun run bench` or `bun run bench:node`.

| Full tree                                   | Bun 1.4.4   | Node 26     |
| ------------------------------------------- | ----------- | ----------- |
| **@lukeed/html**                            | **11.6 ms** | **12.0 ms** |
| @lukeed/html, every attribute and text read | 31.7 ms     | 29.3 ms     |
| ultrahtml                                   | 26.4 ms     | 41.8 ms     |
| htmlparser2                                 | 39.3 ms     | 53.8 ms     |
| node-html-parser                            | 45.6 ms     | 50.7 ms     |
| parse5                                      | 84.9 ms     | 164.5 ms    |
| Bun HTMLRewriter, building a tree           | 43.9 ms     | –           |

| Parse and query title, meta, canonical, links, and images | Bun 1.4.4   | Node 26     |
| --------------------------------------------------------- | ----------- | ----------- |
| **@lukeed/html**                                          | **18.5 ms** | **19.4 ms** |
| lol-html (WASM), streaming                                | 19.4 ms     | 23.5 ms     |
| ultrahtml + selector                                      | 31.4 ms     | 57.3 ms     |
| htmlparser2 + css-select                                  | 50.8 ms     | 70.9 ms     |
| node-html-parser                                          | 64.9 ms     | 68.0 ms     |
| Bun HTMLRewriter (native), streaming                      | 8.8 ms      | –           |

`bun run compare` checks every tree in the corpus, node by node, against htmlparser2.

## License

MIT © [Luke Edwards](https://lukeed.com)
