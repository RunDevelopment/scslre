import type { Literal } from ".";
import { CharSet, JS } from "refa";

export function assertNever(value: never, message?: string): never {
	const error = new Error(message);
	(error as any).data = value;
	throw error;
}

export function charToLiteral(char: CharSet, flags?: JS.Flags): Literal {
	return JS.toLiteral({ type: "CharacterClass", characters: char }, { flags });
}

export function cachedFn<I, O>(fn: (input: I) => O): (input: I) => O {
	const cache = new Map<I, O>();
	return function (input: I): O {
		let value = cache.get(input);
		if (value === undefined) {
			value = fn(input);
			cache.set(input, value);
		}
		return value;
	};
}
