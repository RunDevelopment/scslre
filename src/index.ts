import { CharSet, Words } from "refa";
import { Chars, FollowOperations, followPaths, getClosestAncestor, hasSomeAncestor } from "regexp-ast-analysis";
import { AST, RegExpParser, visitRegExpAST } from "@eslint-community/regexpp";
import {
	assertConsumedRepeatedChar,
	canReachChild,
	concatConsumedRepeatedChars,
	ConsumedRepeatedChar,
	getConsumedRepeatedChar,
	isStared,
	unionConsumedRepeatedChars,
} from "./ast-util";
import { fixSelf } from "./fix/self";
import { fixTrade } from "./fix/trade";
import { assertNever, cachedFn, charToLiteral } from "./util";

export interface AnalysisResult {
	/**
	 * The parse AST of the analysed literal.
	 */
	parsed: ParsedLiteral;
	/**
	 * The analysed literal.
	 */
	literal: Literal;
	/**
	 * A list of all reports found under the constraints of the given analysis options.
	 */
	reports: Report[];
}

export interface ReportBase {
	type: Report["type"];
	/**
	 * The character to be repeated in order to create an input for which the analysed literal will have super-linear
	 * runtime behavior.
	 */
	character: {
		/**
		 * A non-empty set of characters that can be repeated to cause super-linear runtime.
		 *
		 * CharSet is a class from the [refa](https://github.com/RunDevelopment/refa) library.
		 */
		set: CharSet;
		/**
		 * A single character that can be repeated to cause super-linear runtime.
		 *
		 * The implementation is allowed to pick any character in `set` but makes a best effort to pick a
		 * "humanly readable" character.
		 */
		pick: string;
		/**
		 * A literal that represents `set`.
		 *
		 * E.g. if `set` only contained the character "a" (lower case A), then the literal may be `/a/`.
		 */
		literal: Literal;
	};
	/**
	 * Returns a new literal with this cause of super-linear runtime being fixed. If the cause of this report could not
	 * be automatically fixed, `undefined` will be returned.
	 *
	 * A fixed literal is guaranteed to behave exactly the same as the analysed literal.
	 */
	fix(): Literal | undefined;
	/**
	 * Whether the polynomial backtracking of this report causes exponential backtracking.
	 */
	exponential: boolean;
}
/**
 * This report indicates super-linear runtime caused by polynomial backtracking between two distinct quantifiers.
 *
 * ### Examples
 *
 * `/a+a+/`, `/\d*\w+/`, `/a*(?:a{2}d?|cd?)b?a+/`, `/(?:a+ba+){2}/`, `(?:a|ba+)+`
 *
 * ### Description
 *
 * This type of super-linear runtime is caused by the polynomial backtracking between two unbounded quantifiers.
 *
 * #### Start and end quantifiers
 *
 * While the start and end quantifiers are guaranteed to be distinct unbounded quantifiers, one may be parent
 * (or ancestor) of the other (e.g. `/(?:a|ba+)+/`). The matching direction of the quantifiers may also be different
 * (e.g. `/a+(?<!a*b)/`).
 *
 * ### Notes
 *
 * This type is called "trade" because polynomial backtracking between two quantifiers looks like the two quantifiers
 * are exchanging characters, a trade of sorts.
 */
export interface TradeReport extends ReportBase {
	type: "Trade";
	startQuant: AST.Quantifier;
	endQuant: AST.Quantifier;
}
/**
 * This report indicates super-linear runtime cause by polynomial backtracking of a quantifier with itself.
 *
 * ### Examples
 *
 * `(?:a+){2}`, `(?:a+)+`
 *
 * ### Description
 *
 * This type of super-linear runtime is the special case of the trade type ([[`TradeReport`]]) where a quantifier trades characters with
 * itself. As this requires some form of repetition of the quantifier, the self quantifier is always nested within a
 * parent quantifier. The maximum of the parent quantifier determines the degree of polynomial backtracking (e.g.
 * `/(a+){0,3}/` backtracks in _O(n^3)_ and `/(a+)+/` backtracks in _O(2^n)_).
 *
 * ### Fixing
 *
 * To fix these reports, quantifier must be prevent from reaching itself. This can be accomplished by e.g. removing the
 * quantifier (e.g. `/(?:a+)+/` => `/(?:a)+/`), using assertions (e.g. `/(a+|b){0,3}/` => `/(a+(?!a)|b){0,3}/`), or
 * rewriting the affected parts of the pattern. Reports of simple cases usually have a fix for you.
 */
export interface SelfReport extends ReportBase {
	type: "Self";
	/**
	 * An unbounded quantifier that can reach itself.
	 */
	quant: AST.Quantifier;
	/**
	 * A parent quantifier of [[`quant`]].
	 *
	 * The maximum of this quantifier is at least 2.
	 *
	 * This is guaranteed to be not the same quantifier as [[`quant`]].
	 */
	parentQuant: AST.Quantifier;
}
/**
 * This report indicates super-linear runtime cause by the matching algorithm moving the regexes across the input
 * string.
 *
 * ### Examples
 *
 * `/a+b/`
 *
 * ### Description
 *
 * This type of super-linear runtime is not caused by backtracking but by the matching algorithm itself. While the
 * regex engine will try to optimize as much as possible, in some cases, it will be forced to match a pattern against
 * every suffix of the given input string according the
 * [ECMAScript specification](https://tc39.es/ecma262/#sec-regexpbuiltinexec). Because there are _n_ many suffixes for
 * a rejecting input string with length _n_, the total runtime will be the time it takes to reject every suffix times
 * _n_. For non-finite languages, even a DFA (that guarantees _O(n)_ __for every suffix__) might have a total worst-case
 * time complexity of _O(n^2)_.
 *
 * ### Fixing
 *
 * This type of super-linear runtime is the hardest to fix (if at all possible) because the fixed regex has to reject
 * all suffixes with an average worst-case time complexity of _O(1)_.
 *
 * ### Notes
 *
 * Literals with the
 * [sticky flag](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/sticky)
 * (e.g. `/a+b/y`) and anchored literals (e.g. `/^a+b/` and `/\ba+b/` but not `/^\s+b/m` and `/\Ba+b/`) are immune to
 * this type of super-linear runtime.
 *
 * This type can never cause exponential backtracking.
 */
export interface MoveReport extends ReportBase {
	type: "Move";
	/**
	 * The unbounded quantifier that caused this report.
	 */
	quant: AST.Quantifier;
	/**
	 * This type can never cause exponential backtracking.
	 */
	exponential: false;
}
export type Report = TradeReport | MoveReport | SelfReport;

/**
 * A light-weight representation of JS RegExp literal.
 *
 * Only the `source` and `flags` properties have to be given. `source` and `flags` are required to be syntactically
 * valid.
 *
 * Literals are only guaranteed to be compatible with the `RegExp` constructor. The `source` may contain line breaks or
 * unescaped `/` characters. To convert a literal to a valid RegExp literal, use:
 *
 * ```js
 * RegExp(literal.source, literal.flags).toString()
 * ```
 *
 * _Note:_ A [bug](https://bugs.chromium.org/p/v8/issues/detail?id=9618) in v8's `RegExp.properties.toString`
 * implementation caused some line breaks to not be escaped in older versions of NodeJS. You can use
 * [this workaround](https://github.com/terser/terser/pull/425/files#diff-9aa82f0ed674e050695a7422b1cd56d43ce47e6953688a16a003bf49c3481622R216)
 * to correct invalid RegExp literals.
 */
export interface Literal {
	source: string;
	flags: string;
}
/**
 * A representation of a parsed `RegExp` instance.
 *
 * This library uses [regexpp](https://github.com/mysticatea/regexpp) to parse JS RegExps. For more information on the
 * regexpp AST format, see [the definition](https://github.com/mysticatea/regexpp/blob/master/src/ast.ts) or see it live
 * in action on [astexplorer.net](https://astexplorer.net/#/gist/3b0c6dc514ab66df13b87c441a653a1a/latest).
 */
export interface ParsedLiteral {
	pattern: AST.Pattern;
	flags: AST.Flags;
}

export interface AnalysisOptions {
	/**
	 * The maximum number of reports to be returned.
	 *
	 * @default Infinity
	 */
	maxReports?: number;
	/**
	 * A record of allowed report types. All reports of a type that is mapped to `false` will be omitted.
	 *
	 * By default, all report types are allowed.
	 */
	reportTypes?: Partial<Record<Report["type"], boolean>>;
	/**
	 * Whether the analyser is allowed to assume that a rejecting suffix can always be found.
	 *
	 * To exploit ambiguity in quantifiers, it is necessary to force the regex engine to go through all possible paths.
	 * This can only be done by finding a suffix that causes the exploitable part of analysed regex to reject the input
	 * string. If such a suffix cannot be found, the regex is not exploitable.
	 *
	 * If this option is set to `false`, a heuristic will be used to determine whether a rejecting suffix can be found.
	 * This will prevent reporting false positives - non-exploitable quantifiers.
	 *
	 * The heuristic makes the assumption that the regex is used as is - that the regex is not modified or used to
	 * construct other regexes. If this assumption is not met, the heuristic will prevent the reporting of potential
	 * true positives.
	 *
	 * By setting this option to `true`, the heuristic will not be used and all reports are assumed to be true
	 * positives.
	 *
	 * @default false
	 */
	assumeRejectingSuffix?: boolean;
}

const NO_FIX: Report["fix"] = () => undefined;

/**
 * Analyses the given (parsed or unparsed) RegExp literal for causes of super-linear runtime complexity.
 *
 * If the given (unparsed) literal is not a syntactically valid JS RegExp, a `SyntaxError` will be thrown.
 *
 * @param input A literal or parsed literal.
 * @param options An optional record of options.
 */
export function analyse(
	input: Readonly<Literal> | Readonly<ParsedLiteral>,
	options?: Readonly<AnalysisOptions>
): AnalysisResult {
	const { pattern, flags } = parse(input);
	const { maxReports, reportTypes, assumeRejectingSuffix } = withDefaults(options);

	const result: AnalysisResult = {
		parsed: { pattern, flags },
		literal: { source: pattern.raw, flags: flags.raw },
		reports: [],
	};

	if (maxReports <= 0) {
		return result;
	}

	function addReport(report: Report): void {
		if (result.reports.length < maxReports && reportTypes[report.type] !== false) {
			addFix(result.parsed, report);
			result.reports.push(report);
		}
	}

	const getCRC = cachedFn((element: AST.Element) => getConsumedRepeatedChar(element, flags));

	const sharedOperations: FollowOperations<ConsumedRepeatedChar> = {
		fork: s => s,
		join: s => unionConsumedRepeatedChars(s, flags),

		continueAfter(_, state: ConsumedRepeatedChar): boolean {
			return !(state.assert.isEmpty && state.consume.isEmpty) && result.reports.length < maxReports;
		},
		continueInto(_, state: ConsumedRepeatedChar): boolean {
			return !(state.assert.isEmpty && state.consume.isEmpty) && result.reports.length < maxReports;
		},

		leave(element, state: ConsumedRepeatedChar): ConsumedRepeatedChar {
			switch (element.type) {
				case "Assertion":
				case "Backreference":
				case "Character":
				case "CharacterClass":
				case "CharacterSet":
				case "ExpressionCharacterClass":
					return concatConsumedRepeatedChars([state, getCRC(element)], flags);

				case "CapturingGroup":
				case "Group":
				case "Quantifier":
					return state;

				default:
					assertNever(element);
			}
		},
	};

	function getCRCAfterElement(after: AST.Element): ConsumedRepeatedChar {
		return followPaths<ConsumedRepeatedChar>(
			after,
			"next",
			{ consume: Chars.empty(flags), assert: Chars.all(flags) },
			sharedOperations
		);
	}

	const selfReports = new Map<AST.Quantifier, Set<AST.Quantifier>>();
	const tradeReports = new Map<AST.Quantifier, Set<AST.Element>>();
	function alreadyReported<Partner extends AST.Node>(
		reports: Map<AST.Quantifier, Set<Partner>>,
		a: AST.Quantifier,
		b: Partner
	): boolean {
		let value = reports.get(a);
		if (value === undefined) {
			value = new Set();
			reports.set(a, value);
		}
		if (!value.has(b)) {
			value.add(b);
			return false;
		} else {
			return true;
		}
	}

	function getVulnerableChar(prefix: ConsumedRepeatedChar, quant: AST.Quantifier): CharSet {
		const quantCRC = getCRC(quant);

		const vulnerable = quantCRC.consume.intersect(prefix.consume.union(prefix.assert));
		if (vulnerable.isEmpty) {
			return vulnerable;
		}

		if (assumeRejectingSuffix) {
			// as described in the docs of the option, we will assume that we can always find a rejecting suffix
			return vulnerable;
		} else {
			// remove all characters that are an accepting suffix if repeated
			const accepting = assertConsumedRepeatedChar(getCRCAfterElement(quant)).assert;

			return vulnerable.without(accepting);
		}
	}

	function checkQuantifier(start: AST.Quantifier, end: AST.Quantifier, state: ConsumedRepeatedChar): void {
		if (end.max !== Infinity) {
			return;
		}

		const vulnerableChar = getVulnerableChar(state, end);
		if (vulnerableChar.isEmpty) {
			return;
		}

		let quant: AST.Quantifier | undefined;
		let parent: AST.Quantifier | undefined;
		if (start === end) {
			quant = start;
			parent = getParentQuant(start);
		} else if (isParentOf(end, start)) {
			quant = start;
			parent = end;
		} else if (isParentOf(start, end)) {
			quant = end;
			parent = start;
		}

		let assertion;
		if (quant && parent && (assertion = assertionBetweenParentAndChild(parent, quant))) {
			if (!alreadyReported(tradeReports, start, assertion)) {
				addReport({
					type: "Trade",
					startQuant: start,
					endQuant: end,
					character: toReportCharacter(vulnerableChar),
					fix: NO_FIX,
					// this type of ambiguity can't cause exponential backtracking because assertions are
					// guaranteed to be atomic by the ES spec
					exponential: false,
				});
			}
		} else if (
			quant &&
			parent &&
			canReachChild(parent, quant, vulnerableChar, "ltr", flags) &&
			canReachChild(parent, quant, vulnerableChar, "rtl", flags)
		) {
			if (!alreadyReported(selfReports, quant, parent)) {
				addReport({
					type: "Self",
					quant,
					parentQuant: parent,
					character: toReportCharacter(vulnerableChar),
					fix: NO_FIX,
					exponential: isStared(parent),
				});
			}
		} else {
			if (!alreadyReported(tradeReports, start, end)) {
				addReport({
					type: "Trade",
					startQuant: start,
					endQuant: end,
					character: toReportCharacter(vulnerableChar),
					fix: NO_FIX,
					exponential: isStared(getClosestAncestor(start, end)),
				});
			}
		}
	}

	visitRegExpAST(pattern, {
		onQuantifierLeave(node) {
			if (node.max !== Infinity) {
				return;
			}
			if (result.reports.length >= maxReports) {
				return;
			}

			const startChar = getCRC(node.element);
			if (startChar.consume.isEmpty) {
				return;
			}

			followPaths<ConsumedRepeatedChar>(node, "next", startChar, {
				...sharedOperations,

				enter(element, state: ConsumedRepeatedChar): ConsumedRepeatedChar {
					if (element.type === "Quantifier") {
						checkQuantifier(node, element, state);
					}
					return state;
				},
			});

			// this searches specifically for quantifiers inside the current one
			followPaths<ConsumedRepeatedChar>(node, "enter", startChar, {
				...sharedOperations,

				enter(element, state: ConsumedRepeatedChar): ConsumedRepeatedChar {
					if (element !== node && element.type === "Quantifier") {
						checkQuantifier(node, element, state);
					}
					return state;
				},

				continueAfter(element, state, d) {
					return sharedOperations.continueAfter!(element, state, d) && element !== node;
				},
			});
		},
	});

	if (!flags.sticky && result.reports.length < maxReports && reportTypes["Move"] !== false) {
		// move

		// eslint-disable-next-line no-inner-declarations
		function checkMoveQuantifier(quant: AST.Quantifier, state: ConsumedRepeatedChar): void {
			if (quant.max !== Infinity) {
				return;
			}

			const vulnerableChar = getVulnerableChar(state, quant);
			if (vulnerableChar.isEmpty) {
				return;
			}

			// found it
			addReport({
				type: "Move",
				quant,
				character: toReportCharacter(vulnerableChar),
				fix: NO_FIX,
				exponential: false,
			});
		}

		const startChar: ConsumedRepeatedChar = {
			consume: Chars.all(flags),
			assert: Chars.empty(flags),
		};

		for (const alt of pattern.alternatives) {
			if (alt.elements.length === 0) {
				continue;
			}
			followPaths<ConsumedRepeatedChar>(alt.elements[0], "enter", startChar, {
				...sharedOperations,

				enter(element, state: ConsumedRepeatedChar): ConsumedRepeatedChar {
					if (element.type === "Quantifier") {
						checkMoveQuantifier(element, state);
					}

					return state;
				},
			});
		}
	}

	return result;
}

function withDefaults(options?: Readonly<AnalysisOptions>): Required<AnalysisOptions> {
	return {
		maxReports: options?.maxReports ?? Infinity,
		reportTypes: options?.reportTypes ?? {},
		assumeRejectingSuffix: options?.assumeRejectingSuffix ?? false,
	};
}

function addFix(literal: Readonly<ParsedLiteral>, report: Report): void {
	switch (report.type) {
		case "Move": {
			// We cannot provide fixes because of `lastIndex`.
			break;
		}
		case "Self": {
			report.fix = () => {
				const fix = fixSelf(literal, report);
				return fix ? fix : undefined;
			};
			break;
		}
		case "Trade": {
			report.fix = () => {
				const fix = fixTrade(literal, report);
				return fix ? fix : undefined;
			};
			break;
		}
		default:
			assertNever(report);
	}
}

function getParentQuant(element: AST.Node): AST.Quantifier {
	let node: AST.Node | null = element.parent;
	while (node) {
		if (node.type === "Quantifier") {
			return node;
		}
		node = node.parent;
	}
	throw new Error("Cannot get parent quant of `" + element.raw + "`");
}

function toReportCharacter(char: CharSet): Report["character"] {
	return {
		set: char,
		pick: String.fromCodePoint(Words.pickMostReadableCharacter(char)!),
		literal: charToLiteral(char),
	};
}

function isParentOf(parent: AST.Node, child: AST.Node): boolean {
	return hasSomeAncestor(child, a => a === parent);
}
/**
 * Returns the assertion closest to the parent from all assertions between the given parent and child node.
 *
 * @param parent
 * @param child
 */
function assertionBetweenParentAndChild(parent: AST.Node, child: AST.Node): AST.LookaroundAssertion | undefined {
	let p = child.parent;
	let assertion: AST.LookaroundAssertion | undefined = undefined;
	while (p) {
		if (p === parent) {
			return assertion;
		}
		if (p.type === "Assertion") {
			assertion = p;
		}
		p = p.parent;
	}
	throw new Error("The given nodes are not parent and child.");
}

const PARSER = new RegExpParser();
function parse(input: Readonly<Literal> | Readonly<ParsedLiteral>): Readonly<ParsedLiteral> {
	if ("source" in input) {
		// parse
		const flags = PARSER.parseFlags(input.flags);
		const pattern = PARSER.parsePattern(input.source, undefined, undefined, flags);
		return { pattern, flags };
	} else {
		// already parsed
		return input;
	}
}
