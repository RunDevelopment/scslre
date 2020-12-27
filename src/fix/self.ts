import type { Literal, ParsedLiteral, SelfReport } from "..";
import { Quant, quantToString } from "./util";
import { Fixer } from "./fixer";

export function fixSelf(literal: Readonly<ParsedLiteral>, report: Readonly<SelfReport>): Literal | void {
	const { quant, parentQuant } = report;

	if (quant.greedy !== parentQuant.greedy) {
		return;
	}

	const fixer = new Fixer(literal);

	if (
		quant.parent.elements.length === 1 &&
		quant.parent.parent.type === "Group" &&
		quant.parent.parent.parent === parentQuant
	) {
		if (quant.parent.parent.alternatives.length === 1) {
			// trivially nested quantifier (e.g. /(?:a+)*/)

			// https://github.com/RunDevelopment/eslint-plugin-clean-regex/blob/5077b63202c4fdfb22674afc73c518bd87b5f4c1/lib/rules/no-trivially-nested-quantifier.ts#L13
			const a = quant.min;
			const b = quant.max;
			const c = parentQuant.min;
			const d = parentQuant.max;
			const condition = b === Infinity && c === 0 ? a <= 1 : c === d || b * c + 1 >= a * (c + 1);

			if (condition) {
				const combinedQuant: Quant = { min: a * c, max: b * d, greedy: quant.greedy };
				return fixer.replace(parentQuant, quant.element.raw + quantToString(combinedQuant));
			}
		}

		if (parentQuant.max === Infinity) {
			// nested quantifier (e.g. /(?:a+|b|c)*/)
			if (quant.min === 1 || (quant.min === 0 && parentQuant.min === 0)) {
				return fixer.replace(quant, quant.element.raw);
			}
			if (quant.min === 0) {
				return fixer.replace(
					quant,
					quant.element.raw + quantToString({ min: 0, max: 1, greedy: quant.greedy })
				);
			}
		}
	}
}
