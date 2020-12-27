import { nodeResolve } from "@rollup/plugin-node-resolve";
import { terser } from "rollup-plugin-terser";

export default /** @type {import('rollup').RollupOptions[]} */ ([
	{
		input: ".out/index.js",
		external: ["regexpp", "refa"],
		output: {
			file: "index.js",
			format: "cjs",
		},
		plugins: [nodeResolve(), terser()],
	},
]);

