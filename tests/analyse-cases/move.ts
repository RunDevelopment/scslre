import { TestCase } from "../analyse-helper";

export const cases: TestCase[] = [
	{
		literal: /#.*$/,
		expected: [
			{
				type: "Move",
				char: /#/i,
				desc: String.raw`
/#.*$/
  ^~`,
			},
		],
	},
	{
		literal: /\w+a/,
		expected: [
			{
				type: "Move",
				char: /[0-9A-Z_b-z]/,
				desc: String.raw`
/\w+a/
 ^~~`,
			},
		],
	},
];
