import { assertTestCase, TestCase } from "./analyse-helper";
import { literalToString } from "./helper";
import * as mixed from "./analyse-cases/mixed";
import * as move from "./analyse-cases/move";
import * as self from "./analyse-cases/self";
import * as trade from "./analyse-cases/trade";
import * as valid from "./analyse-cases/valid";

describe("analyse", function () {
	const categories: [string, TestCase[]][] = [
		["mixed", mixed.cases],
		["move", move.cases],
		["self", self.cases],
		["trade", trade.cases],
		["valid", valid.cases],
	];

	for (const [name, cases] of categories) {
		describe(name, function () {
			for (const testCase of cases) {
				it(literalToString(testCase.literal), function () {
					assertTestCase(testCase);
				});
			}
		});
	}
});
