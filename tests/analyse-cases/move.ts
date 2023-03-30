import { TestCase } from "../analyse-helper";

export const cases: TestCase[] = [
	{
		literal: /#.*$/,
		expected: [
			{
				type: "Move",
				char: /#/,
				expo: false,
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
				char: /[\dA-Z_b-z]/,
				expo: false,
				desc: String.raw`
/\w+a/
 ^~~`,
			},
		],
	},
	{
		literal: /\w+/,
		options: { assumeRejectingSuffix: true },
		expected: [
			{
				type: "Move",
				char: /\w/,
				expo: false,
				desc: String.raw`
/\w+/
 ^~~`,
			},
		],
	},
];
