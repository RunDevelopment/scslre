import { AST } from "regexpp";
import { hasSomeDescendant, isSingleCharacter, MatchingDirection, toCharSet } from "../ast-util";

export interface Quant {
	min: number;
	max: number;
	greedy: boolean;
}

export function quantToString(quant: Readonly<Quant>): string {
	let q;
	if (quant.min === 0 && quant.max === 1) {
		q = "?";
	} else if (quant.min === 0 && quant.max === Infinity) {
		q = "*";
	} else if (quant.min === 1 && quant.max === Infinity) {
		q = "+";
	} else if (quant.min === quant.max) {
		if (quant.min === 1) {
			return "";
		} else {
			return `{${quant.min}}`;
		}
	} else if (quant.max === Infinity) {
		q = `{${quant.min},}`;
	} else {
		q = `{${quant.min},${quant.max}}`;
	}
	if (!quant.greedy) {
		q += "?";
	}
	return q;
}

export function equalElements(q1: AST.Quantifier, q2: AST.Quantifier, flags: AST.Flags): boolean {
	if (q1.element.raw === q2.element.raw) {
		return true;
	}

	if (isSingleCharacter(q1.element) && isSingleCharacter(q2.element)) {
		return toCharSet(q1.element, flags).equals(toCharSet(q2.element, flags));
	}

	return false;
}

export function withDirection(direction: MatchingDirection, elements: string[]): string {
	if (direction === "ltr") {
		return elements.join("");
	} else {
		return [...elements].reverse().join("");
	}
}

export function withConstQuantifier(element: AST.QuantifiableElement, min: number): string {
	if (min === 0) {
		return "";
	} else if (min === 1) {
		return element.raw;
	} else {
		return element.raw + `{${min}}`;
	}
}

export function containsCapturingGroup(element: AST.Node): boolean {
	return hasSomeDescendant(element, d => d.type === "CapturingGroup");
}
