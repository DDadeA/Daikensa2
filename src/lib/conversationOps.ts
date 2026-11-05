export type ScratchpadAction = 'read' | 'write' | 'append' | 'replace';

export interface ScratchpadParams {
	action: ScratchpadAction;
	content?: string;
	target?: string;
	replacement?: string;
}

// Pure transformation of the note text; throws on invalid input.
export const applyScratchpadAction = (current: string, params: ScratchpadParams): string => {
	switch (params.action) {
		case 'read':
			return current;
		case 'write':
			if (typeof params.content !== 'string') throw new Error('`content` is required for write');
			return params.content;
		case 'append':
			if (typeof params.content !== 'string') throw new Error('`content` is required for append');
			return current ? `${current}\n${params.content}` : params.content;
		case 'replace':
			if (!params.target) throw new Error('`target` is required for replace');
			if (typeof params.replacement !== 'string')
				throw new Error('`replacement` is required for replace');
			if (!current.includes(params.target)) throw new Error('`target` was not found in scratchpad');
			return current.replace(params.target, () => params.replacement as string);
		default:
			throw new Error(`Unknown scratchpad action: ${params.action}`);
	}
};

export const parseSettings = (raw: unknown): Record<string, any> => {
	if (!raw) return {};
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw) || {};
		} catch {
			return {};
		}
	}
	return raw as Record<string, any>;
};

// Replaces the session anchor `Here is [prev]` with `Here is [next]`.
export const rewriteSessionAnchor = (prompt: string, prevTitle: string, nextTitle: string) =>
	prompt.split(`Here is [${prevTitle}]`).join(`Here is [${nextTitle}]`);
