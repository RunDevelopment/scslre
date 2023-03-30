import type { Literal, ParsedLiteral } from "..";
import { AST } from "@eslint-community/regexpp";

export class Fixer {
	readonly source: string;
	flags: string;
	private readonly patternOffset: number;
	constructor(literal: Readonly<ParsedLiteral>) {
		this.source = literal.pattern.raw;
		this.flags = literal.flags.raw;
		this.patternOffset = literal.pattern.start;
	}

	replace(node: AST.Node | AST.Node[], replacement: string): Literal {
		let start, end;
		if (Array.isArray(node)) {
			start = Infinity;
			end = -Infinity;
			for (const n of node) {
				start = Math.min(start, n.start);
				end = Math.max(end, n.end);
			}
		} else {
			start = node.start;
			end = node.end;
		}

		const offset = this.patternOffset;
		return {
			source: this.source.slice(0, start - offset) + replacement + this.source.slice(end - offset),
			flags: this.flags,
		};
	}
}
