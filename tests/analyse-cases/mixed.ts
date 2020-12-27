import { TestCase } from "../analyse-helper";

export const cases: TestCase[] = [
	{
		literal: /^(?:a+\w?a+){0,2}$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				desc: String.raw`
/^(?:a+\w?a+){0,2}$/
     ^~[end]
          ^~[start]`,
			},
			{
				type: "Trade",
				char: /a/,
				expo: false,
				desc: String.raw`
/^(?:a+\w?a+){0,2}$/
     ^~[start]
          ^~[end]`,
			},
			{
				type: "Self",
				char: /a/,
				expo: false,
				desc: String.raw`
/^(?:a+\w?a+){0,2}$/
  ^~~~~~~~~~~~~~~~[parent]
          ^~[self]`,
			},
			{
				type: "Self",
				char: /a/,
				expo: false,
				desc: String.raw`
/^(?:a+\w?a+){0,2}$/
  ^~~~~~~~~~~~~~~~[parent]
     ^~[self]`,
			},
		],
	},
];
