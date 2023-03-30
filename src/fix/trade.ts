import type { Literal, ParsedLiteral, TradeReport } from "..";
import { AST } from "@eslint-community/regexpp";
import { isSingleCharacter, SingleCharacter } from "../ast-util";
import { charToLiteral } from "../util";
import { Fixer } from "./fixer";
import { containsCapturingGroup, equalElements, quantToString, withConstQuantifier, withDirection } from "./util";
import { Concatenation, DFA, JS, NFA, NoParent } from "refa";
import {
	getFirstConsumedChar,
	getMatchingDirection,
	isPotentiallyZeroLength,
	MatchingDirection,
	toCharSet,
} from "regexp-ast-analysis";

export function fixTrade(literal: Readonly<ParsedLiteral>, report: Readonly<TradeReport>): Literal | void {
	const { startQuant, endQuant } = report;

	if (containsCapturingGroup(startQuant) || containsCapturingGroup(endQuant)) {
		return;
	}

	const fixer = new Fixer(literal);

	if (startQuant.parent === endQuant.parent) {
		const direction = getMatchingDirection(startQuant);
		const expectedDirection: MatchingDirection = startQuant.start < endQuant.start ? "ltr" : "rtl";

		// Characters are always consumed from start to end but the path from start to end may not be the direct one:
		// e.g. /(a*ba*){2}/
		//        ^~[end]
		//           ^~[start]

		if (direction === expectedDirection) {
			const elements = startQuant.parent.elements;
			const startIndex = elements.indexOf(startQuant);
			const endIndex = elements.indexOf(endQuant);

			const between = elements.slice(Math.min(startIndex, endIndex) + 1, Math.max(startIndex, endIndex));

			if (between.length === 0) {
				return neighboringQuantifiers(literal, fixer, direction, startQuant, endQuant);
			} else if (between.length === 1) {
				const single = between[0];
				if (single.type === "Quantifier") {
					return quantifierInBetween(literal, fixer, direction, startQuant, endQuant, single);
				} else if (isSingleCharacter(single)) {
					return characterInBetween(literal, fixer, direction, startQuant, endQuant, single);
				}
			}
		}
	}
}

function neighboringQuantifiers(
	literal: Readonly<ParsedLiteral>,
	fixer: Fixer,
	d: MatchingDirection,
	startQuant: AST.Quantifier,
	endQuant: AST.Quantifier
): Literal | void {
	// they are right next to each other (e.g. /a+a*/, /\w+\d*/)

	if (equalElements(startQuant, endQuant, literal.flags)) {
		// e.g. /a+a*/, /(?:a|bc)+(?:a|bc)*/
		return fixer.replace(
			[startQuant, endQuant],
			startQuant.element.raw +
				quantToString({
					min: startQuant.min + endQuant.min,
					max: Infinity,
					greedy: startQuant.greedy || endQuant.greedy,
				})
		);
	}

	if (isSingleCharacter(startQuant.element) && isSingleCharacter(endQuant.element)) {
		const { which, replacement } = neighboringSingleCharQuantifiers(literal.flags, d, startQuant, endQuant);
		return fixer.replace(which, replacement);
	}
}

function neighboringSingleCharQuantifiers(
	flags: AST.Flags,
	d: MatchingDirection,
	startQuant: AST.Quantifier,
	endQuant: AST.Quantifier
): { which: AST.Quantifier; replacement: string } {
	const startChar = toCharSet(startQuant.element as SingleCharacter, flags);
	const endChar = toCharSet(endQuant.element as SingleCharacter, flags);

	let reduceToMin: AST.Quantifier | undefined;
	if (startChar.isSubsetOf(endChar)) {
		// e.g. /\d*\w+/
		reduceToMin = startQuant;
	} else if (endChar.isSubsetOf(startChar)) {
		// e.g. /\w*\d+/
		reduceToMin = endQuant;
	} else {
		reduceToMin = undefined;
	}

	if (reduceToMin) {
		return {
			which: reduceToMin,
			replacement: withConstQuantifier(reduceToMin.element, reduceToMin.min),
		};
	}

	// e.g. /[ab]+[ac]+/ => [ab]+(?:c[ac]*|a)
	// In general: /[ab]{n,}[ac]{m,}/ => /[ab]{n,}(?:c[ac]{m-1,}|a[ac]{m-1})/ if m >= 1
	//                                   /[ab]{n,}(?:c[ac]*)?/ if m == 0

	const unique = charToLiteral(endChar.without(startChar), flags).source;
	const afterUnique =
		endQuant.element.raw +
		quantToString({
			min: Math.max(0, endQuant.min - 1),
			max: Infinity,
			greedy: endQuant.greedy,
		});

	let replacement;
	if (endQuant.min === 0) {
		const lazy = endQuant.greedy ? "" : "?";
		replacement = `(?:${withDirection(d, [unique, afterUnique])})?${lazy}`;
	} else {
		const common = charToLiteral(endChar.intersect(startChar), flags).source;
		const afterCommon = withConstQuantifier(endQuant.element, endQuant.min - 1);
		replacement = `(?:${withDirection(d, [unique, afterUnique])}|${withDirection(d, [common, afterCommon])})`;
	}

	return { which: endQuant, replacement };
}

function quantifierInBetween(
	literal: Readonly<ParsedLiteral>,
	fixer: Fixer,
	d: MatchingDirection,
	startQuant: AST.Quantifier,
	endQuant: AST.Quantifier,
	betweenQuant: AST.Quantifier
): Literal | void {
	if (
		betweenQuant.max === 0 ||
		betweenQuant.min !== 0 ||
		isPotentiallyZeroLength(startQuant.element) ||
		isPotentiallyZeroLength(endQuant.element) ||
		isPotentiallyZeroLength(betweenQuant.element)
	) {
		return;
	}

	// We now have 3 quantifiers with non-empty elements and the quantifier in between has min=0 && max>0
	// E.g. /a*b*a*/, /\d+\.?\d*/

	const startFirstChar = getFirstConsumedChar(startQuant.element, d, literal.flags);
	const endFirstChar = getFirstConsumedChar(endQuant.element, d, literal.flags);
	const betweenFirstChar = getFirstConsumedChar(betweenQuant.element, d, literal.flags);

	function groupAlternatives(alternatives: string[]): string {
		if (startQuant.parent.elements.length === 3 /* 3 == start + between + end */) {
			return alternatives.join("|");
		} else {
			return "(?:" + alternatives.join("|") + ")";
		}
	}
	function betweenWithMinOne(): string {
		return betweenQuant.element.raw + quantToString({ ...betweenQuant, min: 1 });
	}
	const BETWEEN_LAZY_MOD = betweenQuant.greedy ? "" : "?";

	if (
		startFirstChar.char.isDisjointWith(betweenFirstChar.char) &&
		endFirstChar.char.isDisjointWith(betweenFirstChar.char)
	) {
		if (equalElements(startQuant, endQuant, literal.flags)) {
			if (endQuant.min === 0) {
				// e.g. /a+b*a*/ => /a+(?:b+a*)?/
				return fixer.replace(
					[betweenQuant, endQuant],
					"(?:" + withDirection(d, [betweenWithMinOne(), endQuant.raw]) + ")?" + BETWEEN_LAZY_MOD
				);
			}

			if (startQuant.min === 0) {
				if (containsCapturingGroup(betweenQuant)) {
					// /a*b*a+/ => /(?:a*b+)?a+/
					return fixer.replace(
						[startQuant, betweenQuant],
						"(?:" + withDirection(d, [startQuant.raw, betweenWithMinOne()]) + ")?" + BETWEEN_LAZY_MOD
					);
				} else {
					// e.g. /a*b*a+/ == /(a+|)(b+|)a+/ == /(a+|)b+a+|(a+|)a+/ == /a+b+a+|b+a+|a+/ => /a+(b+a+)?|b+a+/
					// This approach makes more copies but is more efficient as it requires less backtracking

					// /b+a+/
					const betweenAndEnd = withDirection(d, [betweenWithMinOne(), endQuant.raw]);

					const alternatives: string[] = [
						// /a+(b+a+)?/
						withDirection(d, [
							startQuant.element.raw + quantToString({ ...startQuant, min: 1 }),
							"(?:" + betweenAndEnd + ")?" + BETWEEN_LAZY_MOD,
						]),
						// /b+a+/
						betweenAndEnd,
					];
					if (!betweenQuant.greedy) {
						alternatives.reverse();
					}

					return fixer.replace([startQuant, betweenQuant, endQuant], groupAlternatives(alternatives));
				}
			}
		}

		if (isSingleCharacter(startQuant.element) && isSingleCharacter(endQuant.element)) {
			// e.g. /[ax]+b*[ay]*/ == /[ax]+b+[ay]*|[ax]+[ay]*/

			const { which, replacement } = neighboringSingleCharQuantifiers(literal.flags, d, startQuant, endQuant);

			if (replacement === "") {
				if (which === startQuant) {
					// e.g. /a*b*[ay]*/ == /a*b+[ay]*|[ay]*/ == /(?:a*b+)?[ay]*/
					return fixer.replace(
						[startQuant, betweenQuant],
						"(?:" + withDirection(d, [startQuant.raw, betweenWithMinOne()]) + ")?" + BETWEEN_LAZY_MOD
					);
				} else {
					// e.g. /[ax]+b*a*/ == /[ax]+b+a*|[ax]+/ == /[ax]+(?:b+a*)?/
					return fixer.replace(
						[betweenQuant, endQuant],
						"(?:" + withDirection(d, [betweenWithMinOne(), endQuant.raw]) + ")?" + BETWEEN_LAZY_MOD
					);
				}
			} else {
				const alternatives: string[] = [
					// [ax]+b+[ay]*
					withDirection(d, [startQuant.raw, betweenWithMinOne(), endQuant.raw]),
					// [ax]+[ay]*
					withDirection(d, [
						startQuant === which ? replacement : startQuant.raw,
						endQuant === which ? replacement : endQuant.raw,
					]),
				];
				if (!betweenQuant.greedy) {
					alternatives.reverse();
				}

				return fixer.replace([startQuant, betweenQuant, endQuant], groupAlternatives(alternatives));
			}
		}
	}
}

function characterInBetween(
	literal: Readonly<ParsedLiteral>,
	fixer: Fixer,
	d: MatchingDirection,
	startQuant: AST.Quantifier,
	endQuant: AST.Quantifier,
	between: SingleCharacter
): Literal | void {
	if (startQuant.element.raw === endQuant.element.raw && startQuant.element.raw === between.raw) {
		// e.g. /a+aa*/
		return fixer.replace(
			[startQuant, between, endQuant],
			startQuant.element.raw +
				quantToString({
					min: startQuant.min + endQuant.min + 1,
					max: Infinity,
					greedy: startQuant.greedy || endQuant.greedy,
				})
		);
	}

	if (
		isSingleCharacter(startQuant.element) &&
		isSingleCharacter(endQuant.element) &&
		startQuant.greedy &&
		endQuant.greedy
	) {
		// /[ax]*[ay][az]*/

		const startChar = toCharSet(startQuant.element, literal.flags);
		const endChar = toCharSet(endQuant.element, literal.flags);
		const betweenChar = toCharSet(between, literal.flags);

		const concat: NoParent<Concatenation> = {
			type: "Concatenation",
			elements: [
				{
					type: "Quantifier",
					min: startQuant.min,
					max: Infinity,
					lazy: false,
					alternatives: [
						{ type: "Concatenation", elements: [{ type: "CharacterClass", characters: startChar }] },
					],
				},
				{ type: "CharacterClass", characters: betweenChar },
				{
					type: "Quantifier",
					min: endQuant.min,
					max: Infinity,
					lazy: false,
					alternatives: [
						{ type: "Concatenation", elements: [{ type: "CharacterClass", characters: endChar }] },
					],
				},
			],
		};
		if (d === "rtl") {
			concat.elements.reverse();
		}

		const dfa = DFA.fromFA(NFA.fromRegex(concat, { maxCharacter: startChar.maximum }));
		dfa.minimize();

		const re = dfa.toRegex();
		const source = JS.toLiteral(re, { flags: literal.flags }).source;
		const replacement = re.alternatives.length > 1 ? "(?:" + source + ")" : source;

		return fixer.replace([startQuant, between, endQuant], replacement);
	}
}
