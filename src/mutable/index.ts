import * as node from "./node";
import * as state from "./state";

import type { Document, Node } from "./node";

export type {
	Comment,
	Content,
	Directive,
	Document,
	Element,
	Node,
	Parent,
	Position,
	Text,
} from "./node";

/**
 * Parse HTML into a mutable {@link Document}. Same tree and selectors as
 * the main module, plus edits to attributes, text, and children.
 * @example
 * let doc = parse("<ul><li>a</li></ul>");
 * doc.find("li")?.set("class", "first");
 * doc.find("ul")?.append(...parse("<li>b</li>").children);
 * stringify(doc); //=> '<ul><li class="first">a</li><li>b</li></ul>'
 */
export function parse(source: string): Document {
	return node.open(state.document(source));
}

/**
 * Serialize a node or document. Unedited parts are copied from the source
 * as written; edited parts are rebuilt with escaped values.
 * @example
 * let doc = parse('<p class=a>x</p>');
 * stringify(doc); //=> "<p class=a>x</p>"
 */
export function stringify(target: Node | Document): string {
	return state.serialize(node.unwrap(target));
}
