import { TestCase } from "../analyse-helper";

export const cases: TestCase[] = [
	{
		literal: /^(?:a|b|c+)+$/,
		expected: [
			{
				type: "Self",
				char: /c/,
				expo: true,
				fixed: /^(?:a|b|c)+$/,
				desc: String.raw`
/^(?:a|b|c+)+$/
  ^~~~~~~~~~~[parent]
         ^~[self]`,
			},
		],
	},
	{
		literal: /^(?:a|b|c+)*$/,
		expected: [
			{
				type: "Self",
				char: /c/,
				expo: true,
				fixed: /^(?:a|b|c)*$/,
				desc: String.raw`
/^(?:a|b|c+)*$/
  ^~~~~~~~~~~[parent]
         ^~[self]`,
			},
		],
	},
	{
		literal: /^(?:a|b|c*)*$/,
		expected: [
			{
				type: "Self",
				char: /c/,
				expo: true,
				fixed: /^(?:a|b|c)*$/,
				desc: String.raw`
/^(?:a|b|c*)*$/
  ^~~~~~~~~~~[parent]
         ^~[self]`,
			},
		],
	},
	{
		literal: /^(?:a|b|c*)+$/,
		expected: [
			{
				type: "Self",
				char: /c/,
				expo: true,
				fixed: /^(?:a|b|c?)+$/,
				desc: String.raw`
/^(?:a|b|c*)+$/
  ^~~~~~~~~~~[parent]
         ^~[self]`,
			},
		],
	},
	{
		literal: /^(?:a+){0,2}$/,
		expected: [
			{
				type: "Self",
				char: /a/,
				expo: false,
				fixed: /^a*$/,
				desc: String.raw`
/^(?:a+){0,2}$/
  ^~~~~~~~~~~[parent]
     ^~[self]`,
			},
		],
	},
	{
		literal: /^(?:a+){3,}$/,
		expected: [
			{
				type: "Self",
				char: /a/,
				expo: true,
				fixed: /^a{3,}$/,
				desc: String.raw`
/^(?:a+){3,}$/
  ^~~~~~~~~~[parent]
     ^~[self]`,
			},
		],
	},
];
