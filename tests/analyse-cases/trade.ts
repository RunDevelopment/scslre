import { TestCase } from "../analyse-helper";

export const cases: TestCase[] = [
	{
		literal: /^a*b*a*$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				fixed: /^a*(?:b+a*)?$/,
				desc: String.raw`
/^a*b*a*$/
  ^~[start]
      ^~[end]`,
			},
		],
	},
	{
		literal: /\b\w+\d*$/,
		expected: [
			{
				type: "Trade",
				char: /\d/i,
				expo: false,
				fixed: /\b\w+$/,
				desc: String.raw`
/\b\w+\d*$/
   ^~~[start]
      ^~~[end]`,
			},
		],
	},
	{
		literal: /\b(?:\d(?:_\d)?)+\.?(?:\d(?:_\d)?)*$/,
		expected: [
			{
				type: "Trade",
				char: /\d/i,
				expo: false,
				fixed: /\b(?:\d(?:_\d)?)+(?:\.(?:\d(?:_\d)?)*)?$/,
				desc: String.raw`
/\b(?:\d(?:_\d)?)+\.?(?:\d(?:_\d)?)*$/
   ^~~~~~~~~~~~~~~[start]
                     ^~~~~~~~~~~~~~~[end]`,
			},
		],
	},
	{
		literal: /^(?:a+ba+){0,2}$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				desc: String.raw`
/^(?:a+ba+){0,2}$/
     ^~[end]
        ^~[start]`,
			},
		],
	},
	{
		literal: /^(?:ba+)*a*$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				desc: String.raw`
/^(?:ba+)*a*$/
      ^~[start]
          ^~[end]`,
			},
		],
	},
	{
		literal: /^\b\d*[._]?\d+(?:e[-+]?\d+)?$/i,
		expected: [
			{
				type: "Trade",
				char: /\d/i,
				expo: false,
				fixed: /^\b(?:\d+(?:[._]\d+)?|[._]\d+)(?:e[-+]?\d+)?$/i,
				desc: String.raw`
/^\b\d*[._]?\d+(?:e[-+]?\d+)?$/i
    ^~~[start]
            ^~~[end]`,
			},
		],
	},
	{
		literal: /^0x[\da-f]*\.?[\da-fp-]+$/i,
		expected: [
			{
				type: "Trade",
				char: /[0-9A-F]/i,
				expo: false,
				fixed: /^0x(?:[\da-f]*\.)?[\da-fp-]+$/i,
				desc: String.raw`
/^0x[\da-f]*\.?[\da-fp-]+$/i
    ^~~~~~~~[start]
               ^~~~~~~~~~[end]`,
			},
		],
	},
	{
		literal: /^[ax]*b*[ay]*$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				fixed: /^(?:[ax]*b+[ay]*|[ax]*(?:y[ay]*)?)$/,
				desc: String.raw`
/^[ax]*b*[ay]*$/
  ^~~~~[start]
         ^~~~~[end]`,
			},
		],
	},
	{
		literal: /^[ax]+b*[ay]+$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				fixed: /^(?:[ax]+b+[ay]+|[ax]+(?:y[ay]*|a))$/,
				desc: String.raw`
/^[ax]+b*[ay]+$/
  ^~~~~[start]
         ^~~~~[end]`,
			},
		],
	},
	{
		literal: /^[ax]*[ay][az]*$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				fixed: /^(?:a*x)*(?:y[az]*|a+(?:[yz][az]*)?)$/,
				desc: String.raw`
/^[ax]*[ay][az]*$/
  ^~~~~[start]
           ^~~~~[end]`,
			},
		],
	},
	{
		literal: /^[ax]+[ay][az]+$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				fixed: /^[ax](?:a*x)*(?:(?:y[az]|a(?:z|y[az]))[az]*|a{2,}(?:(?:z|y[az])[az]*)?)$/,
				desc: String.raw`
/^[ax]+[ay][az]+$/
  ^~~~~[start]
           ^~~~~[end]`,
			},
		],
	},
	{
		literal: /^\w*[a-z]\w*$/,
		expected: [
			{
				type: "Trade",
				char: /[a-z]/,
				expo: false,
				fixed: /^[0-9A-Z_]*[a-z]\w*$/,
				desc: String.raw`
/^\w*[a-z]\w*$/
  ^~~[start]
          ^~~[end]`,
			},
		],
	},
	{
		literal: /^(?:a|ba+)+$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: true,
				desc: String.raw`
/^(?:a|ba+)+$/
  ^~~~~~~~~~[end]
        ^~[start]`,
			},
		],
	},
	{
		literal: /^(?:a|a+b)+$/,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: true,
				desc: String.raw`
/^(?:a|a+b)+$/
  ^~~~~~~~~~[start]
       ^~[end]`,
			},
		],
	},
	{
		literal: /^a+(?<!ba*)/m,
		expected: [
			{
				type: "Trade",
				char: /a/,
				expo: false,
				desc: String.raw`
/^a+(?<!ba*)/m
  ^~[start]
         ^~[end]`,
			},
		],
	},
];
