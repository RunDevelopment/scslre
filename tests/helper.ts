import { Literal } from "../src";

export function literalToString(literal: Literal): string {
	return `/${literal.source}/${literal.flags}`;
}

export function removeIndentation(str: string): string {
	let lines = str.split(/\r?\n/g);
	const minTabCount = lines
		.map(l => (l.length === 0 ? Infinity : /^\t*/.exec(l)![0].length))
		.reduce((a, b) => Math.min(a, b), Infinity);
	if (minTabCount !== Infinity && minTabCount > 0) {
		lines = lines.map(l =>
			l.length === 0 ? "" : l.substr(minTabCount).replace(/^(\t+)/, m => "    ".repeat(m.length))
		);
	}
	return lines.join("\n");
}

interface Highlight {
	start: number;
	end: number;
	label?: string;
}
export function underLine(line: string, highlights: Highlight[], offset: number = 0): string {
	highlights.sort((a, b) => a.start - b.start);

	const lines = [line];
	while (highlights.length > 0) {
		const newHighlights: Highlight[] = [];
		let l = "";
		for (const highlight of highlights) {
			const start = highlight.start + offset;
			const end = highlight.end + offset;
			if (start < l.length) {
				newHighlights.push(highlight);
			} else {
				l += " ".repeat(start - l.length);
				l += "^";
				l += "~".repeat(end - start - 1);
				if (highlight.label) {
					l += "[" + highlight.label + "]";
				}
			}
		}
		lines.push(l);
		highlights = newHighlights;
	}

	return lines.join("\n");
}
