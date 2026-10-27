# Entity decoder experiment

> Not used by the package. Kept for reference; probably not worth shipping.

A replacement for the `entities` decoder. It follows the HTML spec for character references: longest-prefix matching for the 106 legacy names, the attribute-mode exception, the Windows-1252 remap, and U+FFFD for invalid code points. It has a fast path for `&quot;`, `&amp;`, `&gt;`, and `&lt;`, which are 98.7% of the references in the corpus.

```sh
$ bun run bench entities:generate  # write data.ts from the WHATWG entities.json
$ bun run bench entities:diff      # compare with entities, in text and attribute mode
$ bun run bench entities:bench     # speed, with mitata
$ bun run bench entities:size      # bundle size
```

## Findings

- **Correct:** identical to `entities` on 242,792 inputs, in both modes. These are every entity name in 9 contexts, numeric edge cases, 200,000 random strings, and every corpus value with `&`.
- **Faster on real pages only:** corpus attribute values decode 1.75x faster on Bun and 1.45x on Node. Corpus text is about equal. Rare named entities and numeric references are 1.05x to 1.4x slower.
- **Small end-to-end gain:** decoding the whole corpus takes about 1.1 ms with `entities` and 0.65 ms with this decoder. That is about 1.5% of "parse + read all", and nothing for plain parsing.
- **Smaller:** 12.8 kB gzipped against 15.6 kB for the `entities` code the package uses. Front-coding the sorted names would bring the data to about 11 kB; that is measured, not implemented.
