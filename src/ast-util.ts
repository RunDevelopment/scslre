import { CharSet } from "refa";
import {
	isStrictBackreference,
	Chars,
	followPaths,
	getEffectiveMaximumRepetition,
	getFirstCharAfter,
	isEmptyBackreference,
	MatchingDirection,
	toCharSet,
} from "regexp-ast-analysis";
import { AST } from "regexpp";
import { assertNever } from "./util";

export type SingleCharacter = AST.Character | AST.CharacterClass | AST.CharacterSet;
export function isSingleCharacter(node: AST.Node): node is SingleCharacter {
	switch (node.type) {
		case "Character":
		case "CharacterClass":
		case "CharacterSet":
			return true;

		default:
			return false;
	}
}

/**
 * This represents a character `/[char]|(?=[assert])/` (the direction of the lookaround may differ).
 */
export interface ConsumedRepeatedChar {
	readonly consume: CharSet;
	readonly assert: CharSet;
}
export function concatConsumedRepeatedChars(
	iter: Iterable<ConsumedRepeatedChar>,
	flags: AST.Flags
): ConsumedRepeatedChar {
	if (Array.isArray(iter)) {
		if (iter.length === 0) {
			return { consume: Chars.empty(flags), assert: Chars.all(flags) };
		} else if (iter.length === 1) {
			return iter[0];
		}
	}
	/**
	 * Concatenation:
	 *
	 * The basic idea here is that the concatenation of two characters a and b is their intersection (?=b)a == (?=a)b.
	 *
	 * (a|(?=c))(b|(?=d)) == ab|a(?=d)|(?=c)b|(?=c)(?=d) == ab|a(?=d)|(?=c)b|(?=(?=d)c)
	 *   => (?=b)a|(?=d)a|(?=c)b|(?=(?=d)c) == (?=[bd])a|(?=c)b|(?=(?=d)c)
	 */
	let consume = Chars.empty(flags);
	let assert = Chars.all(flags);
	for (const char of iter) {
		//if (assert.isEmpty) {
		//	consume = consume.intersect(char.consume.union(char.assert));
		//} else {
		consume = consume.intersect(char.consume.union(char.assert)).union(char.consume.intersect(assert));
		assert = assert.intersect(char.assert);
		//}

		if (assert.isEmpty && consume.isEmpty) {
			break;
		}
	}

	return { consume, assert };
}
export function unionConsumedRepeatedChars(
	iter: Iterable<ConsumedRepeatedChar>,
	flags: AST.Flags
): ConsumedRepeatedChar {
	if (Array.isArray(iter) && iter.length === 1) {
		return iter[0];
	}
	/**
	 * Alternation:
	 *
	 * (a|(?=c))|(b|(?=d)) == a|b|(?=c)|(?=d) == [ab]|(?=[cd])
	 */
	let consume = Chars.empty(flags);
	let assert = Chars.empty(flags);
	for (const other of iter) {
		consume = consume.union(other.consume);
		assert = assert.union(other.assert);
	}

	return { consume, assert };
}
export function assertConsumedRepeatedChar(char: ConsumedRepeatedChar): ConsumedRepeatedChar {
	/**
	 * Assertion:
	 *
	 * (?=(a|(?=c))) == (?=a|(?=c)) == (?=a|c) == (?=[ac]) == []|(?=[ac])
	 */
	return { consume: CharSet.empty(char.consume.maximum), assert: char.consume.union(char.assert) };
}
export function getConsumedRepeatedChar(node: AST.Node | AST.Alternative[], flags: AST.Flags): ConsumedRepeatedChar {
	if (Array.isArray(node)) {
		return unionConsumedRepeatedChars(
			node.map(alt => getConsumedRepeatedChar(alt, flags)),
			flags
		);
	}

	switch (node.type) {
		case "Alternative": {
			return concatConsumedRepeatedChars(
				(function* () {
					for (const item of node.elements) {
						yield getConsumedRepeatedChar(item, flags);
					}
				})(),
				flags
			);
		}
		case "Assertion": {
			switch (node.kind) {
				case "end":
				case "start": {
					if (flags.multiline) {
						return { consume: Chars.empty(flags), assert: Chars.lineTerminator(flags) };
					} else {
						return { consume: Chars.empty(flags), assert: Chars.empty(flags) };
					}
				}
				case "word": {
					// \b == (?:(?<=\w)(?!\w)|(?<!\w)(?=\w))
					// \B == (?:(?<=\w)(?=\w)|(?<!\w)(?!\w))

					const word = Chars.word(flags);
					const nonWord = word.negate();

					for (const direction of ["ltr", "rtl"] as const) {
						const after = getFirstCharAfter(node, direction, flags);
						if (!after.edge) {
							if (after.char.isSubsetOf(word)) {
								return { consume: Chars.empty(flags), assert: node.negate ? word : nonWord };
							}
							if (after.char.isSubsetOf(nonWord)) {
								return { consume: Chars.empty(flags), assert: node.negate ? nonWord : word };
							}
						}
					}

					if (node.negate) {
						return { consume: Chars.empty(flags), assert: Chars.all(flags) };
					} else {
						return { consume: Chars.empty(flags), assert: Chars.empty(flags) };
					}
				}
				case "lookahead":
				case "lookbehind": {
					const assert = assertConsumedRepeatedChar(getConsumedRepeatedChar(node.alternatives, flags));
					if (node.negate) {
						return {
							consume: Chars.empty(flags),
							assert: assert.assert.negate(),
						};
					} else {
						return assert;
					}
				}
			}
			throw assertNever(node);
		}
		case "CapturingGroup":
		case "Group":
		case "Pattern": {
			return getConsumedRepeatedChar(node.alternatives, flags);
		}
		case "Character":
		case "CharacterClass":
		case "CharacterSet": {
			return { consume: toCharSet(node, flags), assert: Chars.empty(flags) };
		}
		case "Quantifier": {
			if (node.max === 0) {
				return { consume: Chars.empty(flags), assert: Chars.all(flags) };
			} else if (node.min === 0) {
				return { consume: getConsumedRepeatedChar(node.element, flags).consume, assert: Chars.all(flags) };
			} else {
				return getConsumedRepeatedChar(node.element, flags);
			}
		}
		case "RegExpLiteral": {
			return getConsumedRepeatedChar(node.pattern, flags);
		}
		case "Backreference": {
			if (isEmptyBackreference(node)) {
				return { consume: Chars.empty(flags), assert: Chars.all(flags) };
			} else {
				const char = getConsumedRepeatedChar(node.resolved, flags);
				if (isStrictBackreference(node)) {
					return char;
				} else {
					// potentially empty
					return { consume: char.consume, assert: Chars.all(flags) };
				}
			}
		}
		case "CharacterClassRange":
		case "Flags": {
			throw new Error("This doesn't make any sense");
		}
		default:
			assertNever(node);
	}
}

export function canReachChild(
	parent: AST.Element,
	child: AST.Element,
	repeatedChar: CharSet,
	direction: MatchingDirection,
	flags: AST.Flags
): boolean {
	const enum State {
		CONTINUE,
		FOUND,
		STOP,
	}

	const result = followPaths<State>(
		parent,
		"enter",
		State.CONTINUE,
		{
			fork: s => s,
			join(states: State[]): State {
				if (states.every(s => s === State.STOP)) {
					return State.STOP;
				} else if (states.some(s => s === State.FOUND)) {
					return State.FOUND;
				} else {
					return State.CONTINUE;
				}
			},
			assert: (s, _, a) => (a === State.FOUND ? a : s),

			continueAfter(e, s) {
				return e !== parent && s === State.CONTINUE;
			},
			continueInto(_, s) {
				return s === State.CONTINUE;
			},

			enter: (element, s) => (element === child ? State.FOUND : s),
			leave(element, s) {
				if (s !== State.CONTINUE) {
					return s;
				}

				switch (element.type) {
					case "Assertion":
					case "Backreference":
					case "Character":
					case "CharacterClass":
					case "CharacterSet": {
						const elementChar = getConsumedRepeatedChar(element, flags);
						const combinedChar = elementChar.consume.union(elementChar.assert);
						if (repeatedChar.isSubsetOf(combinedChar)) {
							return State.CONTINUE;
						} else {
							return State.STOP;
						}
					}

					case "CapturingGroup":
					case "Group":
					case "Quantifier":
						return s;

					default:
						assertNever(element);
				}
			},
		},
		direction
	);
	return result === State.FOUND;
}

/**
 * Returns whether the given node is a star quantifier or is under a star quantifier.
 *
 * The search for a star will stop if an assertion or the pattern itself has been reached while going up the tree.
 *
 * @param element
 */
export function isStared(element: AST.Node): boolean {
	let max = getEffectiveMaximumRepetition(element);
	if (element.type === "Quantifier") {
		max *= element.max;
	}
	return max > 20;
}
