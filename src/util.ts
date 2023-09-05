import type { Literal } from ".";
import { CharSet, JS } from "refa";

export function assertNever(value: never, message?: string): never {
	const error = new Error(message);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(error as any).data = value;
	throw error;
}

export function charToLiteral(char: CharSet, flags?: JS.UncheckedFlags): Literal {
	if (flags !== undefined && !JS.isFlags(flags)) {
		throw new Error("Invalid flags");
	}
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
