import { CharSet, JS } from "refa";
import { AST } from "regexpp";
import { assertNever } from "./util";

export function getMaxCharacter(unicode: boolean): number {
	return unicode ? 0x10ffff : 0xffff;
}
export function emptyCharSet(flags: AST.Flags): CharSet {
	return CharSet.empty(getMaxCharacter(flags.unicode));
}
export function allCharSet(flags: AST.Flags): CharSet {
	return CharSet.all(getMaxCharacter(flags.unicode));
}

const UNICODE_LINE_TERMINATOR = JS.createCharSet([{ kind: "any" }], { unicode: true }).negate();
const UTF16_LINE_TERMINATOR = JS.createCharSet([{ kind: "any" }], { unicode: false }).negate();
export function lineTerminatorCharSet(flags: AST.Flags): CharSet {
	return flags.unicode ? UNICODE_LINE_TERMINATOR : UTF16_LINE_TERMINATOR;
}

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

export function toCharSet(node: SingleCharacter, flags: AST.Flags): CharSet {
	switch (node.type) {
		case "Character": {
			return JS.createCharSet([node.value], flags);
		}
		case "CharacterClass": {
			const value = JS.createCharSet(
				node.elements.map(x => {
					if (x.type === "CharacterSet") {
						return x;
					} else if (x.type === "Character") {
						return x.value;
					} else {
						return { min: x.min.value, max: x.max.value };
					}
				}),
				flags
			);

			if (node.negate) {
				return value.negate();
			} else {
				return value;
			}
		}
		case "CharacterSet": {
			return JS.createCharSet([node], flags);
		}
		default:
			assertNever(node);
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
			return { consume: emptyCharSet(flags), assert: allCharSet(flags) };
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
	let consume = emptyCharSet(flags);
	let assert = allCharSet(flags);
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
	let consume = emptyCharSet(flags);
	let assert = emptyCharSet(flags);
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
						return { consume: emptyCharSet(flags), assert: lineTerminatorCharSet(flags) };
					} else {
						return { consume: emptyCharSet(flags), assert: emptyCharSet(flags) };
					}
				}
				case "word": {
					// \b == (?:(?<=\w)(?!\w)|(?<!\w)(?=\w))
					// \B == (?:(?<=\w)(?=\w)|(?<!\w)(?!\w))

					const word = JS.createCharSet([{ kind: "word", negate: false }], flags);
					const nonWord = JS.createCharSet([{ kind: "word", negate: true }], flags);

					for (const direction of ["ltr", "rtl"] as const) {
						const after = getFirstCharAfter(node, direction, flags);
						if (!after.edge) {
							if (after.char.isSubsetOf(word)) {
								return { consume: emptyCharSet(flags), assert: node.negate ? word : nonWord };
							}
							if (after.char.isSubsetOf(nonWord)) {
								return { consume: emptyCharSet(flags), assert: node.negate ? nonWord : word };
							}
						}
					}

					if (node.negate) {
						return { consume: emptyCharSet(flags), assert: allCharSet(flags) };
					} else {
						return { consume: emptyCharSet(flags), assert: emptyCharSet(flags) };
					}
				}
				case "lookahead":
				case "lookbehind": {
					const assert = assertConsumedRepeatedChar(getConsumedRepeatedChar(node.alternatives, flags));
					if (node.negate) {
						return {
							consume: emptyCharSet(flags),
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
			return { consume: toCharSet(node, flags), assert: emptyCharSet(flags) };
		}
		case "Quantifier": {
			if (node.max === 0) {
				return { consume: emptyCharSet(flags), assert: allCharSet(flags) };
			} else if (node.min === 0) {
				return { consume: getConsumedRepeatedChar(node.element, flags).consume, assert: allCharSet(flags) };
			} else {
				return getConsumedRepeatedChar(node.element, flags);
			}
		}
		case "RegExpLiteral": {
			return getConsumedRepeatedChar(node.pattern, flags);
		}
		case "Backreference": {
			if (isEmptyBackreference(node)) {
				return { consume: emptyCharSet(flags), assert: allCharSet(flags) };
			} else {
				const char = getConsumedRepeatedChar(node.resolved, flags);
				if (backreferenceAlwaysAfterGroup(node)) {
					return char;
				} else {
					// potentially empty
					return { consume: char.consume, assert: allCharSet(flags) };
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
 * Returns whether all paths of the given element don't move the position of the automaton.
 */
export function isZeroLength(element: AST.Element | AST.Alternative | AST.Alternative[]): boolean {
	if (Array.isArray(element)) {
		return element.every(a => isZeroLength(a));
	}

	switch (element.type) {
		case "Alternative":
			return element.elements.every(e => isZeroLength(e));

		case "Assertion":
			return true;

		case "Character":
		case "CharacterClass":
		case "CharacterSet":
			return false;

		case "Quantifier":
			return element.max === 0 || isZeroLength(element.element);

		case "Backreference":
			return isEmptyBackreference(element);

		case "CapturingGroup":
		case "Group":
			return isZeroLength(element.alternatives);

		default:
			throw assertNever(element);
	}
}

/**
 * Returns whether at least one path of the given element does not move the position of the automation.
 */
export function isPotentiallyZeroLength(element: AST.Element | AST.Alternative | AST.Alternative[]): boolean {
	if (Array.isArray(element)) {
		return element.some(a => isPotentiallyZeroLength(a));
	}

	switch (element.type) {
		case "Alternative":
			return element.elements.every(e => isPotentiallyZeroLength(e));

		case "Assertion":
			return true;

		case "Backreference":
			if (isEmptyBackreference(element)) {
				return true;
			}
			return isPotentiallyZeroLength(element.resolved);

		case "Character":
		case "CharacterClass":
		case "CharacterSet":
			return false;

		case "CapturingGroup":
		case "Group":
			return isPotentiallyZeroLength(element.alternatives);

		case "Quantifier":
			return element.min === 0 || isPotentiallyZeroLength(element.element);

		default:
			throw assertNever(element);
	}
}

/**
 * Returns whether all paths of the given element does not move the position of the automation and accept
 * regardless of prefix and suffix.
 *
 * @param {Element | Alternative | Alternative[]} element
 */
export function isEmpty(element: AST.Element | AST.Alternative | AST.Alternative[]): boolean {
	if (Array.isArray(element)) {
		return element.every(isEmpty);
	}

	switch (element.type) {
		case "Alternative":
			return element.elements.every(isEmpty);

		case "Assertion":
			// assertion do not consume characters but they do usually reject some pre- or suffixes
			if (element.kind === "lookahead" || element.kind === "lookbehind") {
				if (!element.negate && isPotentiallyEmpty(element.alternatives)) {
					// if a positive lookaround is potentially empty, it will trivially accept all pre- or suffixes
					return true;
				}
			}
			return false;

		case "Backreference":
			if (isEmptyBackreference(element)) {
				return true;
			}
			return isEmpty(element.resolved);

		case "Character":
		case "CharacterClass":
		case "CharacterSet":
			return false;

		case "CapturingGroup":
		case "Group":
			return isEmpty(element.alternatives);

		case "Quantifier":
			return element.max === 0 || isEmpty(element.element);

		default:
			throw assertNever(element);
	}
}

export interface IsPotentiallyEmptyOptions {
	/**
	 * If `true`, then backreferences that aren't guaranteed to always be replaced with the empty string will be
	 * assumed to be non-empty.
	 */
	backreferencesAreNonEmpty?: boolean;
}
/**
 * Returns whether at least one path of the given element does not move the position of the automation and accepts
 * regardless of prefix and suffix.
 *
 * This basically means that it can match the empty string and that it does that at any position in any string.
 * Lookarounds do not affect this as (as mentioned above) all prefixes and suffixes are accepted.
 */
export function isPotentiallyEmpty(
	element: AST.Element | AST.Alternative | AST.Alternative[],
	options: Readonly<IsPotentiallyEmptyOptions> = {}
): boolean {
	if (Array.isArray(element)) {
		return element.some(a => isPotentiallyEmpty(a, options));
	}

	switch (element.type) {
		case "Alternative":
			return element.elements.every(e => isPotentiallyEmpty(e, options));

		case "Assertion":
			// assertion do not consume characters but they do usually reject some pre- or suffixes
			if (element.kind === "lookahead" || element.kind === "lookbehind") {
				if (!element.negate && isPotentiallyEmpty(element.alternatives, options)) {
					// if a positive lookaround is potentially empty, it will trivially accept all pre- or suffixes
					return true;
				}
			}
			return false;

		case "Backreference":
			if (isEmptyBackreference(element)) {
				return true;
			}
			if (options.backreferencesAreNonEmpty) {
				return false;
			} else {
				return !backreferenceAlwaysAfterGroup(element) || isPotentiallyEmpty(element.resolved, options);
			}

		case "Character":
		case "CharacterClass":
		case "CharacterSet":
			return false;

		case "CapturingGroup":
		case "Group":
			return isPotentiallyEmpty(element.alternatives, options);

		case "Quantifier":
			return element.min === 0 || isPotentiallyEmpty(element.element, options);

		default:
			throw assertNever(element);
	}
}

/**
 * Returns whether any of the ancestors of the given node fulfills the given condition.
 *
 * The ancestors will be iterated in the order from closest to farthest.
 * The condition function will not be called on the given node.
 */
export function hasSomeAncestor(node: AST.Node, conditionFn: (ancestor: AST.BranchNode) => boolean): boolean {
	let parent: AST.Node["parent"] = node.parent;
	while (parent) {
		if (conditionFn(parent)) {
			return true;
		}
		parent = parent.parent;
	}
	return false;
}

export type Descendants<T> = T | (T extends AST.Node ? RealDescendants<T> : never);
type RealDescendants<T extends AST.Node> = T extends
	| AST.Alternative
	| AST.CapturingGroup
	| AST.Group
	| AST.LookaroundAssertion
	| AST.Quantifier
	| AST.Pattern
	? AST.Element | AST.CharacterClassElement
	: never | T extends AST.CharacterClass
	? AST.CharacterClassElement
	: never | T extends AST.CharacterClassRange
	? AST.Character
	: never | T extends AST.RegExpLiteral
	? AST.Flags | AST.Pattern | AST.Element | AST.CharacterClassElement
	: never;

/**
 * Returns whether any of the descendants of the given node fulfill the given condition.
 *
 * The descendants will be iterated in a DFS top-to-bottom manner from left to right with the first node being the
 * given node.
 *
 * This function is short-circuited, so as soon as any `conditionFn` returns `true`, `true` will be returned.
 *
 * @param node
 * @param conditionFn
 * @param descentConditionFn An optional function to decide whether the descendant of the given node will be checked as
 * well.
 */
export function hasSomeDescendant<T extends AST.Node>(
	node: T & AST.Node,
	conditionFn: (descendant: Descendants<T>) => boolean,
	descentConditionFn?: (descendant: Descendants<T>) => boolean
): boolean {
	if (conditionFn(node)) {
		return true;
	}

	if (descentConditionFn && !descentConditionFn(node)) {
		return false;
	}

	switch (node.type) {
		case "Alternative":
			return node.elements.some(e => hasSomeDescendant(e, conditionFn, descentConditionFn));
		case "Assertion":
			if (node.kind === "lookahead" || node.kind === "lookbehind") {
				return node.alternatives.some(a => hasSomeDescendant(a, conditionFn, descentConditionFn));
			}
			return false;
		case "CapturingGroup":
		case "Group":
		case "Pattern":
			return node.alternatives.some(a => hasSomeDescendant(a, conditionFn, descentConditionFn));
		case "CharacterClass":
			return node.elements.some(e => hasSomeDescendant(e, conditionFn, descentConditionFn));
		case "CharacterClassRange":
			return (
				hasSomeDescendant(node.min, conditionFn, descentConditionFn) ||
				hasSomeDescendant(node.max, conditionFn, descentConditionFn)
			);
		case "Quantifier":
			return hasSomeDescendant(node.element, conditionFn, descentConditionFn);
		case "RegExpLiteral":
			return (
				hasSomeDescendant(node.pattern, conditionFn, descentConditionFn) ||
				hasSomeDescendant(node.flags, conditionFn, descentConditionFn)
			);
	}
	return false;
}

/**
 * Returns whether the given backreference will always be replaced with the empty string.
 */
export function isEmptyBackreference(backreference: AST.Backreference): boolean {
	const group = backreference.resolved;

	if (hasSomeAncestor(backreference, a => a === group)) {
		// if the backreference is element of the referenced group
		return true;
	}

	if (isZeroLength(group)) {
		// If the referenced group can only match doesn't consume characters, then it can only capture the empty
		// string.
		return true;
	}

	// Now for the hard part:
	// If there exists a path through the regular expression which connect the group and the backreference, then
	// the backreference can capture the group iff we only move up, down, or right relative to the group.

	function findBackreference(node: AST.Element): boolean {
		const parent = node.parent;

		switch (parent.type) {
			case "Alternative": {
				// if any elements right to the given node contain or are the backreference, we found it.
				const index = parent.elements.indexOf(node);

				// we have to take the current matching direction into account
				let next;
				if (matchingDirectionOf(node) === "ltr") {
					// the next elements to match will be right to the given node
					next = parent.elements.slice(index + 1);
				} else {
					// the next elements to match will be left to the given node
					next = parent.elements.slice(0, index);
				}

				if (next.some(e => hasSomeDescendant(e, d => d === backreference))) {
					return true;
				}

				// no luck. let's go up!
				const parentParent = parent.parent;
				if (parentParent.type === "Pattern") {
					// can't go up.
					return false;
				} else {
					return findBackreference(parentParent);
				}
			}

			case "Quantifier":
				return findBackreference(parent);

			default:
				throw new Error("What happened?");
		}
	}

	return !findBackreference(group);
}

/**
 * Returns whether the given backreference is always matched __after__ the referenced group was matched.
 *
 * If there exists any accepting path which goes through the backreference but not through the referenced group,
 * this will return `false`.
 */
export function backreferenceAlwaysAfterGroup(backreference: AST.Backreference): boolean {
	const group = backreference.resolved;

	if (hasSomeAncestor(backreference, a => a === group)) {
		// if the backreference is element of the referenced group
		return false;
	}

	function findBackreference(node: AST.Element): boolean {
		const parent = node.parent;

		switch (parent.type) {
			case "Alternative": {
				// if any elements right to the given node contain or are the backreference, we found it.
				const index = parent.elements.indexOf(node);

				// we have to take the current matching direction into account
				let next;
				if (matchingDirectionOf(node) === "ltr") {
					// the next elements to match will be right to the given node
					next = parent.elements.slice(index + 1);
				} else {
					// the next elements to match will be left to the given node
					next = parent.elements.slice(0, index);
				}

				if (next.some(e => hasSomeDescendant(e, d => d === backreference))) {
					return true;
				}

				// no luck. let's go up!
				const parentParent = parent.parent;
				if (parentParent.type === "Pattern") {
					// can't go up.
					return false;
				} else {
					if (parentParent.alternatives.length > 1) {
						// e.g.: (?:a|(a))+b\1
						return false;
					}
					return findBackreference(parentParent);
				}
			}

			case "Quantifier":
				if (parent.min === 0) {
					// e.g.: (a+)?b\1
					return false;
				}
				return findBackreference(parent);

			default:
				throw new Error("What happened?");
		}
	}

	return findBackreference(group);
}

export type MatchingDirection = "ltr" | "rtl";
/**
 * Returns the direction which which the given node will be matched relative to the closest parent alternative.
 */
export function matchingDirectionOf(node: AST.Node): MatchingDirection {
	let closestLookaround: AST.LookaroundAssertion | undefined;
	hasSomeAncestor(node, a => {
		if (a.type === "Assertion") {
			closestLookaround = a;
			return true;
		}
		return false;
	});

	if (closestLookaround !== undefined && closestLookaround.kind === "lookbehind") {
		// the matching direction in a lookbehind is right to left
		return "rtl";
	}
	// the standard matching direction is left to right
	return "ltr";
}
export function assertionKindToMatchingDirection(
	kind: AST.LookaroundAssertion["kind"] | AST.EdgeAssertion["kind"]
): MatchingDirection {
	return kind === "end" || kind === "lookahead" ? "ltr" : "rtl";
}

/**
 * Returns how many characters the given element can consume at most and has to consume at least.
 *
 * If `undefined`, then the given element can't consume any characters.
 */
export function getLengthRange(
	element: AST.Element | AST.Alternative | AST.Alternative[]
): { min: number; max: number } | undefined {
	if (Array.isArray(element)) {
		let min = Infinity;
		let max = 0;

		for (const e of element) {
			const eRange = getLengthRange(e);
			if (eRange) {
				min = Math.min(min, eRange.min);
				max = Math.max(max, eRange.max);
			}
		}

		if (min > max) {
			return undefined;
		} else {
			return { min, max };
		}
	}

	switch (element.type) {
		case "Assertion":
			return { min: 0, max: 0 };

		case "Character":
		case "CharacterClass":
		case "CharacterSet":
			return { min: 1, max: 1 };

		case "Quantifier": {
			if (element.max === 0) {
				return { min: 0, max: 0 };
			}
			const elementRange = getLengthRange(element.element);
			if (!elementRange) {
				return element.min === 0 ? { min: 0, max: 0 } : undefined;
			}

			if (elementRange.max === 0) {
				return { min: 0, max: 0 };
			}
			elementRange.min *= element.min;
			elementRange.max *= element.max;
			return elementRange;
		}

		case "Alternative": {
			let min = 0;
			let max = 0;

			for (const e of element.elements) {
				const eRange = getLengthRange(e);
				if (!eRange) {
					return undefined;
				}
				min += eRange.min;
				max += eRange.max;
			}

			return { min, max };
		}

		case "CapturingGroup":
		case "Group":
			return getLengthRange(element.alternatives);

		case "Backreference": {
			if (isEmptyBackreference(element)) {
				return { min: 0, max: 0 };
			}
			const resolvedRange = getLengthRange(element.resolved);
			if (!resolvedRange) {
				return backreferenceAlwaysAfterGroup(element) ? undefined : { min: 0, max: 0 };
			}

			if (resolvedRange.min > 0 && !backreferenceAlwaysAfterGroup(element)) {
				resolvedRange.min = 0;
			}
			return resolvedRange;
		}

		default:
			throw assertNever(element);
	}
}

export interface FirstLookChar {
	/**
	 * A super set of the first character.
	 *
	 * We can usually only guarantee a super set because lookaround in the pattern may narrow down the actual character
	 * set.
	 */
	char: CharSet;
	/**
	 * If `true`, then the first character can be the start/end of the string.
	 */
	edge: boolean;
	/**
	 * If `true`, then `char` is guaranteed to be exactly the first character and not just a super set of it.
	 */
	exact: boolean;
}
export type FirstConsumedChar = FirstFullyConsumedChar | FirstPartiallyConsumedChar;
/**
 * This is equivalent to a regex fragment `[char]`.
 */
export interface FirstFullyConsumedChar {
	/**
	 * A super set of the first character.
	 *
	 * We can usually only guarantee a super set because lookaround in the pattern may narrow down the actual character
	 * set.
	 */
	char: CharSet;
	/**
	 * If `true`, then the first character also includes the empty word.
	 */
	empty: false;
	/**
	 * If `true`, then `char` is guaranteed to be exactly the first character and not just a super set of it.
	 */
	exact: boolean;
}
/**
 * This is equivalent to a regex fragment `[char]|(?=[look.char])` or `[char]|(?=[look.char]|$)` depending on
 * `look.edge`.
 */
export interface FirstPartiallyConsumedChar {
	/**
	 * A super set of the first character.
	 *
	 * We can usually only guarantee a super set because lookaround in the pattern may narrow down the actual character
	 * set.
	 */
	char: CharSet;
	/**
	 * If `true`, then the first character also includes the empty word.
	 */
	empty: true;
	/**
	 * If `true`, then `char` is guaranteed to be exactly the first character and not just a super set of it.
	 */
	exact: boolean;
	/**
	 * A set of characters that may come after the consumed character
	 */
	look: FirstLookChar;
}

/**
 * If a character is returned, it guaranteed to be a super set of the actual character. If the given element is
 * always of zero length, then the empty character set will be returned.
 *
 * If `exact` is `true` then it is guaranteed that the returned character is guaranteed to be the actual
 * character at all times if this element is not influenced by lookarounds outside itself.
 */
export function getFirstCharConsumedBy(
	element: AST.Element | AST.Alternative | AST.Alternative[],
	direction: MatchingDirection,
	flags: AST.Flags
): FirstConsumedChar {
	if (Array.isArray(element)) {
		return firstConsumedCharUnion(
			element.map(e => getFirstCharConsumedBy(e, direction, flags)),
			flags
		);
	}

	switch (element.type) {
		case "Assertion":
			switch (element.kind) {
				case "word":
					return misdirectedAssertion();
				case "end":
				case "start":
					if (assertionKindToMatchingDirection(element.kind) === direction) {
						if (flags.multiline) {
							return lineAssertion();
						} else {
							return edgeAssertion();
						}
					} else {
						return misdirectedAssertion();
					}
				case "lookahead":
				case "lookbehind":
					if (assertionKindToMatchingDirection(element.kind) === direction) {
						if (element.negate) {
							// we can only meaningfully analyse negative lookarounds of the form `(?![a])`
							if (hasSomeDescendant(element, d => d !== element && d.type === "Assertion")) {
								return misdirectedAssertion();
							}
							const firstChar = getFirstCharConsumedBy(element.alternatives, direction, flags);
							const range = getLengthRange(element.alternatives);
							if (firstChar.empty || !range) {
								// trivially rejecting
								return { char: emptyCharSet(flags), empty: false, exact: true };
							}

							if (!firstChar.exact || range.max !== 1) {
								// the goal to to convert `(?![a])` to `(?=[^a]|$)` but this negation is only correct
								// if the characters are exact and if the assertion asserts at most one character
								// E.g. `(?![a][b])` == `(?=$|[^a]|[a][^b])`
								return misdirectedAssertion();
							} else {
								return emptyWord({ char: firstChar.char.negate(), edge: true, exact: true });
							}
						} else {
							const firstChar = getFirstCharConsumedBy(element.alternatives, direction, flags);
							return emptyWord(firstConsumedToLook(firstChar));
						}
					} else {
						return misdirectedAssertion();
					}
				default:
					throw assertNever(element);
			}

		case "Character":
		case "CharacterSet":
		case "CharacterClass":
			return { char: toCharSet(element, flags), empty: false, exact: true };

		case "Quantifier": {
			if (element.max === 0) {
				return emptyWord();
			}

			const firstChar = getFirstCharConsumedBy(element.element, direction, flags);
			if (element.min === 0) {
				return firstConsumedCharUnion([emptyWord(), firstChar], flags);
			} else {
				return firstChar;
			}
		}

		case "Alternative": {
			let elements = element.elements;
			if (direction === "rtl") {
				elements = [...elements];
				elements.reverse();
			}

			return firstConsumedCharConcat(
				(function* (): Iterable<FirstConsumedChar> {
					for (const e of elements) {
						yield getFirstCharConsumedBy(e, direction, flags);
					}
				})(),
				flags
			);
		}

		case "CapturingGroup":
		case "Group":
			return getFirstCharConsumedBy(element.alternatives, direction, flags);

		case "Backreference": {
			if (isEmptyBackreference(element)) {
				return emptyWord();
			}
			const resolvedChar = getFirstCharConsumedBy(element.resolved, direction, flags);

			// the resolved character is only exact if it is only a single character.
			// i.e. /(\w)\1/ here the (\w) will capture exactly any word character, but the \1 can only match
			// one word character and that is the only (\w) matched.
			resolvedChar.exact = resolvedChar.exact && resolvedChar.char.size <= 1;

			if (backreferenceAlwaysAfterGroup(element)) {
				return resolvedChar;
			} else {
				// there is at least one path through which the backreference will (possibly) be replaced with the
				// empty string
				return firstConsumedCharUnion([resolvedChar, emptyWord()], flags);
			}
		}

		default:
			throw assertNever(element);
	}

	/**
	 * The result for an assertion that (partly) assert for the wrong matching direction.
	 */
	function misdirectedAssertion(): FirstPartiallyConsumedChar {
		return emptyWord({
			char: allCharSet(flags),
			edge: true,
			// This is the important part.
			// Since the allowed chars depend on the previous chars, we don't know which will be allowed.
			exact: false,
		});
	}
	function edgeAssertion(): FirstPartiallyConsumedChar {
		return emptyWord(firstLookCharEdgeAccepting(flags));
	}
	function lineAssertion(): FirstPartiallyConsumedChar {
		return emptyWord({
			char: lineTerminatorCharSet(flags),
			edge: true,
			exact: true,
		});
	}
	function emptyWord(look?: FirstLookChar): FirstPartiallyConsumedChar {
		return firstConsumedCharEmptyWord(flags, look);
	}
}
/**
 * Returns first-look-char that is equivalent to a trivially-accepting lookaround.
 */
function firstLookCharTriviallyAccepting(flags: AST.Flags): FirstLookChar {
	return { char: allCharSet(flags), edge: true, exact: true };
}
/**
 * Returns first-look-char that is equivalent to `/$/`.
 */
function firstLookCharEdgeAccepting(flags: AST.Flags): FirstLookChar {
	return { char: emptyCharSet(flags), edge: true, exact: true };
}
/**
 * Returns first-consumed-char that is equivalent to consuming nothing (the empty word) followed by a trivially
 * accepting lookaround.
 */
function firstConsumedCharEmptyWord(flags: AST.Flags, look?: FirstLookChar): FirstPartiallyConsumedChar {
	return {
		char: emptyCharSet(flags),
		empty: true,
		exact: true,
		look: look ?? firstLookCharTriviallyAccepting(flags),
	};
}
class CharUnion {
	char: CharSet;
	exact: boolean;
	private constructor(char: CharSet) {
		this.char = char;
		this.exact = true;
	}
	add(char: CharSet, exact: boolean): void {
		// basic idea here is that the union or an exact superset with an inexact subset will be exact
		if (this.exact && !exact && !this.char.isSupersetOf(char)) {
			this.exact = false;
		} else if (!this.exact && exact && char.isSupersetOf(this.char)) {
			this.exact = true;
		}

		this.char = this.char.union(char);
	}
	static emptyFromFlags(flags: AST.Flags): CharUnion {
		return new CharUnion(emptyCharSet(flags));
	}
	static emptyFromMaximum(maximum: number): CharUnion {
		return new CharUnion(CharSet.empty(maximum));
	}
}
function firstConsumedCharUnion(iter: Iterable<Readonly<FirstConsumedChar>>, flags: AST.Flags): FirstConsumedChar {
	const union = CharUnion.emptyFromFlags(flags);
	const looks: FirstLookChar[] = [];

	for (const itemChar of iter) {
		union.add(itemChar.char, itemChar.exact);
		if (itemChar.empty) {
			looks.push(itemChar.look);
		}
	}

	if (looks.length > 0) {
		// This means that the unioned elements look something like this:
		//   (a|(?=g)|b?|x)
		//
		// Adding the trivially accepting look after all all alternatives that can be empty, we'll get:
		//   (a|(?=g)|b?|x)
		//   (a|(?=g)|b?(?=[^]|$)|x)
		//   (a|(?=g)|b(?=[^]|$)|(?=[^]|$)|x)
		//
		// Since we are only interested in the first character, the look in `b(?=[^]|$)` can be removed.
		//   (a|(?=g)|b|(?=[^]|$)|x)
		//   (a|b|x|(?=g)|(?=[^]|$))
		//   ([abx]|(?=g)|(?=[^]|$))
		//
		// To union the looks, we can simply use the fact that `(?=a)|(?=b)` == `(?=a|b)`
		//   ([abx]|(?=g)|(?=[^]|$))
		//   ([abx]|(?=g|[^]|$))
		//   ([abx]|(?=[^]|$))
		//
		// And with that we are done. This is exactly the form of a first partial char. Getting the exactness of the
		// union of normal chars and look chars follows the same rules.

		const lookUnion = CharUnion.emptyFromFlags(flags);
		let edge = false;
		for (const look of looks) {
			lookUnion.add(look.char, look.exact);
			edge = edge || look.edge;
		}
		return {
			char: union.char,
			exact: union.exact,
			empty: true,
			look: { char: lookUnion.char, exact: lookUnion.exact, edge },
		};
	} else {
		return { char: union.char, exact: union.exact, empty: false };
	}
}
function firstConsumedCharConcat(iter: Iterable<Readonly<FirstConsumedChar>>, flags: AST.Flags): FirstConsumedChar {
	const union = CharUnion.emptyFromFlags(flags);
	let look = firstLookCharTriviallyAccepting(flags);

	for (const item of iter) {
		union.add(item.char.intersect(look.char), look.exact && item.exact);

		if (item.empty) {
			// This is the hard case. We need to convert the expression
			//   (a|(?=b))(c|(?=d))
			// into an expression
			//   e|(?=f)
			// (we will completely ignore edge assertions for now)
			//
			// To do that, we'll use the following idea:
			//   (a|(?=b))(c|(?=d))
			//   a(c|(?=d))|(?=b)(c|(?=d))
			//   ac|a(?=d)|(?=b)c|(?=b)(?=d)
			//
			// Since we are only interested in the first char, we can remove the `c` in `ac` and the `(?=d)` in
			// `a(?=d)`. Furthermore, `(?=b)c` is a single char, so let's call it `C` for now.
			//   ac|a(?=d)|(?=b)c|(?=b)(?=d)
			//   a|a|C|(?=b)(?=d)
			//   [aC]|(?=b)(?=d)
			//   [aC]|(?=(?=b)d)
			//
			// This is *almost* the desired form. We now have to convert `(?=(?=b)d)` to an expression of the form
			// `(?=f)`. This is the point where we can't ignore edge assertions any longer. Let's look at all possible
			// cases and see how it plays out. Also, let `D` be the char intersection of `b` and `d`.
			//   (1) (?=(?=b)d)
			//       (?=D)
			//
			//   (2) (?=(?=b)(d|$))
			//       (?=(?=b)d|(?=b)$)
			//       (?=D)
			//
			//   (3) (?=(?=b|$)d)
			//       (?=((?=b)|$)d)
			//       (?=(?=b)d|$d)
			//       (?=D)
			//
			//   (4) (?=(?=b|$)(d|$))
			//       (?=((?=b)|$)(d|$))
			//       (?=(?=b)(d|$)|$(d|$))
			//       (?=(?=b)d|(?=b)$|$d|$$)
			//       (?=D|$)
			//
			// As we can see, the look char is always `D` and the edge is only accepted if it's accepted by both.

			const charIntersection = look.char.intersect(item.look.char);
			look = {
				char: charIntersection,
				exact: (look.exact && item.look.exact) || charIntersection.isEmpty,
				edge: look.edge && item.look.edge,
			};
		} else {
			return { char: union.char, exact: union.exact, empty: false };
		}
	}
	return { char: union.char, exact: union.exact, empty: true, look };
}
/**
 * This wraps the first-consumed-char object in a look.
 */
function firstConsumedToLook(first: Readonly<FirstConsumedChar>): FirstLookChar {
	if (first.empty) {
		// We have 2 cases:
		//   (1) (?=a|(?=b))
		//       (?=a|b)
		//       (?=[ab])
		//   (2) (?=a|(?=b|$))
		//       (?=a|b|$)
		//       (?=[ab]|$)
		const union = CharUnion.emptyFromMaximum(first.char.maximum);
		union.add(first.char, first.exact);
		union.add(first.look.char, first.look.exact);

		return {
			char: union.char,
			exact: union.exact,
			edge: first.look.edge,
		};
	} else {
		// It's already in the correct form:
		//   (?=a)
		return {
			char: first.char,
			exact: first.exact,
			edge: false,
		};
	}
}

export interface FollowOperations<S> {
	/**
	 * Split off a new path from the given one.
	 *
	 * The given state should not be modified. If the state is immutable, then `fork` may be implemented as the identify
	 * function in regard to `state`.
	 */
	fork(state: S, direction: MatchingDirection): S;
	/**
	 * Joins any number but of paths to create a combined path.
	 */
	join(states: S[], direction: MatchingDirection): S;
	/**
	 * This function is called when dealing to general lookarounds (it will __not__ be called for predefined assertion -
	 * `^`, `$`, `\b`, `\B`).
	 */
	assert?: (state: S, direction: MatchingDirection, assertion: S, assertionDirection: MatchingDirection) => S;

	enter?: (element: AST.Element, state: S, direction: MatchingDirection) => S;
	leave?: (element: AST.Element, state: S, direction: MatchingDirection) => S;
	endPath?: (state: S, direction: MatchingDirection, reason: "pattern" | "assertion") => S;

	/**
	 * Whether the current path should go into the given element (return `true`) or whether it should be skipped
	 * (return `false`). If the element is skipped, the given state will not be changed and passed as-is to the `leave`
	 * function.
	 *
	 * You shouldn't modify state in this function. Modify state in the `enter` function instead.
	 */
	continueInto?: (element: AST.Element, state: S, direction: MatchingDirection) => boolean;
	/**
	 * Whether the current path should continue after the given element (return `true`) or whether all elements that
	 * follow this element should be skipped (return `false`).
	 *
	 * If the current path is a fork path, then only the elements until the fork is joined will be skipped. A stopped
	 * fork path will be joined with all other forks like normal.
	 *
	 * You shouldn't modify state in this function. Modify state in the `leave` function instead.
	 */
	continueAfter?: (element: AST.Element, state: S, direction: MatchingDirection) => boolean;
}
/**
 * This function goes to all elements reachable from the given `start`.
 *
 * ## Paths
 *
 * The function uses _paths_ for this. A path is an [execution path](https://en.wikipedia.org/wiki/Symbolic_execution)
 * that is described by a sequence of regex elements.
 *
 * I.e. there are two paths to go from `a` to `b` in the pattern `/a(\w|dd)b/`. The first path is `a \w b` and the
 * second path is `a d d b`.
 *
 * However, the problem with paths is that there can be exponentially many because of combinatorial explosion (e.g. the
 * pattern `/(a|b)(a|b)(a|b)(a|b)(a|b)/` has 32 paths). To solve this problem, this function will _join_ paths together
 * again.
 *
 * I.e. In the pattern `/a(\w|dd)b/`, first element of all paths will be `a`. After `a`, the path splits into two. We
 * call each of the split paths a _fork_. The two forks will be `a ( \w` and `a ( d d`. The `(` is used to indicate that
 * a fork was made. Since both paths come together after the group ends, they will be _joined_. The joined path of
 * `a ( \w` and `a ( d d` will be written as `a ( \w | d d )`. The `)` is used to indicate that forks have been joined.
 * The final path will be `a ( \w | d d ) b`.
 *
 * This method of forking and joining works for alternations but it won't work for quantifiers. This is why quantifiers
 * will be treated as single elements that can be entered. By default, a quantifier `q` will be interpreted as `( q | )`
 * if its minimum is zero and as `( q )` otherwise.
 *
 * ### State
 *
 * Paths are thought of as a sequence of elements and they are represented by state (type parameter `S`). All operations
 * that fork, join, or assert paths will operate on state and not a sequence of elements.
 *
 * State allows flow operations to be implemented more efficiently and ensures that only necessary data is passed
 * around. Flow analysis for paths usually tracks properties and analyses how these properties change, the current
 * values of these properties is state.
 *
 * ## Flow operations
 *
 * Flow operations are specific to the type of the state and act upon the state. The define how the state of paths
 * changes when encountering elements and how paths fork, join, and continue.
 *
 * ### Operation sequence
 *
 * To follow all paths, two operations are necessary: one operations that enters elements and one that determines the
 * next element. These operations will be called `Enter` and `Next` respectively. The operation will call the given
 * flow operations like this:
 *
 * ```txt
 * function Enter(element, state):
 *     operations.enter
 *     if operations.continueInto:
 *         if elementType == GROUP:
 *             operations.join(
 *                 alternatives.map(e => Enter(e, operations.fork(state)))
 *             )
 *         if elementType == QUANTIFIER:
 *             if quantifierMin == 0:
 *                 operations.join([
 *                     state,
 *                     Enter(quantifier, operations.fork(state))
 *                 ])
 *         if elementType == LOOKAROUND:
 *             operations.assert(
 *                 state,
 *                 operations.join(
 *                     alternatives.map(e => Enter(e, operations.fork(state)))
 *                 )
 *             )
 *     operations.leave
 *     Next(element, state)
 *
 * function Next(element, state):
 *     if operations.continueAfter:
 *         if noNextElement:
 *             operations.endPath
 *         else:
 *             Enter(nextElement, state)
 * ```
 *
 * (This is just simplified pseudo code but the general order of operations will be the same.)
 *
 * ## Runtime
 *
 * If `n` elements can be reached from the given starting element, then the average runtime will be `O(n)` and the
 * worst-case runtime will be `O(n^2)`.
 *
 * @param start
 * @param startMode If "enter", then the first element to be entered will be the starting element. If "leave", then the
 * first element to continue after will be the starting element.
 * @param initialState
 * @param operations
 * @param direction
 */
export function followPaths<S>(
	start: AST.Element,
	startMode: "enter" | "next",
	initialState: NonNullable<S>,
	operations: FollowOperations<NonNullable<S>>,
	direction?: MatchingDirection
): NonNullable<S> {
	function opEnter(element: AST.Element, state: NonNullable<S>, direction: MatchingDirection): NonNullable<S> {
		state = operations.enter?.(element, state, direction) ?? state;

		const continueInto = operations.continueInto?.(element, state, direction) ?? true;
		if (continueInto) {
			switch (element.type) {
				case "Assertion": {
					if (element.kind === "lookahead" || element.kind === "lookbehind") {
						const assertionDirection = assertionKindToMatchingDirection(element.kind);
						const assertion = operations.join(
							element.alternatives.map(a =>
								enterAlternative(a, operations.fork(state, direction), assertionDirection)
							),
							assertionDirection
						);
						state = operations.endPath?.(state, assertionDirection, "assertion") ?? state;
						state = operations.assert?.(state, direction, assertion, assertionDirection) ?? state;
					}
					break;
				}
				case "Group":
				case "CapturingGroup": {
					state = operations.join(
						element.alternatives.map(a =>
							enterAlternative(a, operations.fork(state, direction), direction)
						),
						direction
					);
					break;
				}
				case "Quantifier": {
					if (element.max === 0) {
						// do nothing
					} else if (element.min === 0) {
						state = operations.join(
							[state, opEnter(element.element, operations.fork(state, direction), direction)],
							direction
						);
					} else {
						state = opEnter(element.element, state, direction);
					}
					break;
				}
			}
		}

		state = operations.leave?.(element, state, direction) ?? state;
		return state;
	}
	function enterAlternative(
		alternative: AST.Alternative,
		state: NonNullable<S>,
		direction: MatchingDirection
	): NonNullable<S> {
		let i = direction === "ltr" ? 0 : alternative.elements.length - 1;
		const increment = direction === "ltr" ? +1 : -1;
		let element: AST.Element | undefined;
		for (; (element = alternative.elements[i]); i += increment) {
			state = opEnter(element, state, direction);

			const continueAfter = operations.continueAfter?.(element, state, direction) ?? true;
			if (!continueAfter) {
				break;
			}
		}

		return state;
	}

	function opNext(element: AST.Element, state: NonNullable<S>, direction: MatchingDirection): NonNullable<S> {
		type NextElement = false | AST.Element | "pattern" | "assertion" | [AST.Quantifier, NextElement];
		function getNextElement(element: AST.Element): NextElement {
			const parent = element.parent;
			if (parent.type === "CharacterClass" || parent.type === "CharacterClassRange") {
				throw new Error("The given element cannot be part of a character class.");
			}

			const continuePath = operations.continueAfter?.(element, state, direction) ?? true;
			if (!continuePath) {
				return false;
			}

			if (parent.type === "Quantifier") {
				// This is difficult.
				// The main problem is that paths coming out of the quantifier might loop back into itself. This means that
				// we have to consider the path that leaves the quantifier and the path that goes back into the quantifier.
				if (parent.max <= 1) {
					// Can't loop, so we only have to consider the path going out of the quantifier.
					return getNextElement(parent);
				} else {
					return [parent, getNextElement(parent)];
				}
			} else {
				const nextIndex = parent.elements.indexOf(element) + (direction === "ltr" ? +1 : -1);
				const nextElement: AST.Element | undefined = parent.elements[nextIndex];

				if (nextElement) {
					return nextElement;
				} else {
					const parentParent = parent.parent;
					if (parentParent.type === "Pattern") {
						return "pattern";
					} else if (parentParent.type === "Assertion") {
						return "assertion";
					} else if (parentParent.type === "CapturingGroup" || parentParent.type === "Group") {
						return getNextElement(parentParent);
					}
					throw assertNever(parentParent);
				}
			}
		}

		// eslint-disable-next-line no-constant-condition
		while (true) {
			let after = getNextElement(element);
			while (Array.isArray(after)) {
				const [quant, other] = after;
				state = operations.join(
					[state, opEnter(quant, operations.fork(state, direction), direction)],
					direction
				);
				after = other;
			}

			if (after === false) {
				return state;
			} else if (after === "assertion" || after === "pattern") {
				state = operations.endPath?.(state, direction, after) ?? state;
				return state;
			} else {
				state = opEnter(after, state, direction);
				element = after;
			}
		}
	}

	if (!direction) {
		direction = matchingDirectionOf(start);
	}
	if (startMode === "enter") {
		initialState = opEnter(start, initialState, direction);
	}
	return opNext(start, initialState, direction);
}

export interface FirstConsumedCharAfter {
	char: FirstConsumedChar;
	elements: AST.Element[];
}
export function getFirstConsumedCharAfter(
	afterThis: AST.Element,
	direction: MatchingDirection,
	flags: AST.Flags
): FirstConsumedChar {
	type State = Readonly<FirstConsumedChar>;
	const result = followPaths<State>(
		afterThis,
		"next",
		firstConsumedCharEmptyWord(flags),
		{
			fork(state): State {
				return state;
			},
			join(states): State {
				return firstConsumedCharUnion(states, flags);
			},

			enter(element, state, direction): State {
				const first = getFirstCharConsumedBy(element, direction, flags);
				return firstConsumedCharConcat([state, first], flags);
			},

			continueInto(): boolean {
				return false;
			},
			continueAfter(_, state): boolean {
				return state.empty;
			},
		},
		direction
	);

	return result;
}

/**
 * Returns the first character after the given element.
 *
 * What "after" means depends the on the given direction which will be interpreted as the current matching
 * direction. You can use this to get the previous character of an element as well.
 */
export function getFirstCharAfter(
	afterThis: AST.Element,
	direction: MatchingDirection,
	flags: AST.Flags
): FirstLookChar {
	const result = getFirstConsumedCharAfter(afterThis, direction, flags);
	return firstConsumedToLook(result);
}

/**
 * Returns whether the given node is a star quantifier or is under a star quantifier.
 *
 * The search for a star will stop if an assertion or the pattern itself has been reached while going up the tree.
 *
 * @param element
 */
export function isStared(element: AST.Node): boolean {
	let e: AST.Node | null = element;
	while (e) {
		if (e.type === "Quantifier" && e.max === Infinity) {
			return true;
		}
		if (e !== element && e.type === "Assertion") {
			return false;
		}
		e = e.parent;
	}
	return false;
}

export function getCommonAncestor(a: AST.Element, b: AST.Element): AST.BranchNode | AST.Element {
	if (a === b) {
		return a;
	} else if (a.parent === b.parent) {
		return a.parent;
	} else if (hasSomeAncestor(a, an => an === b)) {
		return b;
	} else if (hasSomeAncestor(b, an => an === a)) {
		return a;
	} else {
		const aAncestors: AST.BranchNode[] = [];
		const bAncestors: AST.BranchNode[] = [];

		let a_: AST.BranchNode | null = a.parent;
		for (; a_; a_ = a_.parent) {
			aAncestors.push(a_);
		}
		let b_: AST.BranchNode | null = b.parent;
		for (; b_; b_ = b_.parent) {
			bAncestors.push(b_);
		}

		while (aAncestors.length && bAncestors.length) {
			if (aAncestors[aAncestors.length - 1] === bAncestors[bAncestors.length - 1]) {
				aAncestors.pop();
				bAncestors.pop();
			} else {
				break;
			}
		}

		if (aAncestors.length === 0) {
			return a.parent;
		}
		if (bAncestors.length === 0) {
			return b.parent;
		}

		const p = aAncestors.pop()!.parent;
		if (p == null) {
			throw new Error("The two nodes are not part of the same tree.");
		}
		return p;
	}
}
