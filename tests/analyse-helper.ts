import { assert } from "chai";
import { analyse, AnalysisOptions, AnalysisResult, Literal, Report } from "../src";
import { assertNever } from "../src/util";
import { literalToString, removeIndentation, underLine } from "./helper";

const DEBUG = true;

export interface ReportDesc {
	type: Report["type"];
	desc: string;
	fixed?: Literal;
	char: Literal;
}
export interface TestCase {
	literal: Literal;
	options?: AnalysisOptions;
	expected?: ReportDesc[];
}

export function assertTestCase({ literal, options, expected = [] }: TestCase): void {
	const result = analyse(literal, options);
	const actual = result.reports.map(r => toReportDesc(result, r)).sort((a, b) => a.desc.localeCompare(b.desc));

	// remove the indentation of all descriptions
	expected = expected.map(e => ({ ...e, desc: removeIndentation(e.desc).trim() }));

	function allActual(): string {
		return `All actual:\n\n${actual.map(printReportDesc).join(",\n")}\n`;
	}

	if (actual.length !== expected.length) {
		if (DEBUG) {
			// eslint-disable-next-line no-debugger
			debugger;
			result;
			// do it again to step through the code
			analyse(literal, options);
		}
		assert.fail(`Found ${actual.length} cases but expected ${expected.length}.\n\n${allActual()}`);
	}

	for (let i = 0; i < actual.length; i++) {
		const a = printReportDesc(actual[i]);
		const e = printReportDesc(expected[i]);

		if (a !== e) {
			if (DEBUG) {
				// eslint-disable-next-line no-debugger
				debugger;
				result;
				// do it again to step through the code
				analyse(literal, options);
			}

			let msg = `Case index ${i}: Actual:\n${a}`;
			if (actual.length > 1) {
				msg += `\n\n${allActual()}`;
			}
			msg += "\n\n";

			assert.strictEqual(a, e, msg);
		}
	}
}

function toReportDesc(result: AnalysisResult, r: Report): ReportDesc {
	const offset = 1 - result.parsed.pattern.start;

	switch (r.type) {
		case "Trade": {
			return {
				type: r.type,
				char: r.character.literal,
				fixed: r.fix?.(),
				desc: underLine(
					literalToString(result.literal),
					[
						{ ...r.startQuant, label: "start" },
						{ ...r.endQuant, label: "end" },
					],
					offset
				),
			};
		}
		case "Move": {
			return {
				type: r.type,
				char: r.character.literal,
				fixed: r.fix?.(),
				desc: underLine(literalToString(result.literal), [r.quant], offset),
			};
		}
		case "Self": {
			return {
				type: r.type,
				char: r.character.literal,
				fixed: r.fix?.(),
				desc: underLine(
					literalToString(result.literal),
					[
						{ ...r.quant, label: "self" },
						{ ...r.parentQuant, label: "parent" },
					],
					offset
				),
			};
		}
		default:
			assertNever(r);
	}
}

function printReportDesc(r: ReportDesc): string {
	const lines: string[] = [];

	lines.push(`type: ${JSON.stringify(r.type)},`);
	lines.push(`char: ${literalToString(r.char)},`);
	if (r.fixed) {
		lines.push(`fixed: ${literalToString(r.fixed)},`);
	}
	lines.push(`desc: String.raw\`\n${r.desc}\`,`);

	return `{\n${lines.map(l => " ".repeat(4) + l).join("\n")}\n}`;
}
