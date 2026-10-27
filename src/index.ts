import * as node from "./node";
import * as tree from "./tree";

import type { Document, Node } from "./node";

export type {
	Comment,
	Directive,
	Document,
	Element,
	Node,
	Parent,
	Position,
	Text,
} from "./node";

/**
 * Parse HTML into a {@link Document}. Never throws; malformed HTML is
 * recovered the same way htmlparser2 does.
 * @example
 * let doc = parse('<title>Hi</title><link rel="canonical" href="/">');
 * doc.query("title")?.text; //=> "Hi"
 * doc.query("link[rel=canonical]")?.attr("href"); //=> "/"
 */
export function parse(source: string): Document {
	return new node.Document(tree.build(source));
}

/**
 * The HTML of a node or document, exactly as written in the source.
 * @example
 * let [item] = parse("<ul><li>a</li></ul>").queryAll("li");
 * stringify(item); //=> "<li>a</li>"
 */
export function stringify(target: Node | Document): string {
	if (target.type === "document") return target.source;
	return target.document.source.slice(target.start, target.end);
}
