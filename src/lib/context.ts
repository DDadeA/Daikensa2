import type { Content, Part } from '@google/genai';
import type { ImageContextMode, Message } from '$lib/types';

export const IMAGE_DECAY_RECENT_IMAGE_TURNS = 2;
export const IMAGE_DECAY_RECENT_MESSAGES = 4;

const isImagePart = (part: any) =>
	!!part?.inlineData?.data &&
	(part.inlineData.mimeType?.startsWith('image/') || part.inlineData.data.startsWith('data:image'));

const isGeneratedImagePart = (part: any, role: string) =>
	isImagePart(part) && (role === 'model' || !!part.imageMeta);

// Appends the scratchpad block to the system prompt (a hard-coded note block in the prompt does not conflict).
export const buildSystemPrompt = (systemPrompt: string, scratchpad?: string | null): string => {
	if (!scratchpad || !scratchpad.trim()) return systemPrompt;
	return `${systemPrompt}\n\n## Active Scratchpad (슬기의 노트)\n${scratchpad}`;
};

const describeImage = (part: any) => {
	const meta = part.imageMeta || {};
	const prompt = meta.positivePrompt ?? 'unknown';
	const seed = meta.seed ?? 'unknown';
	return `[Past Generated Image | Prompt: ${prompt} | Seed: ${seed}]`;
};

// Converts messages into API contents. Old generated images become text metadata; UI messages are untouched.
export const buildContext = (
	messages: Message[],
	options: { recentImageTurns?: number; recentMessages?: number } = {}
): Content[] => {
	const recentImageTurns = options.recentImageTurns ?? IMAGE_DECAY_RECENT_IMAGE_TURNS;
	const recentMessages = options.recentMessages ?? IMAGE_DECAY_RECENT_MESSAGES;

	// Index (from the newest) of each message that holds a generated image
	const imageRank = new Map<number, number>();
	let rank = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		if ((messages[i].parts || []).some((p) => isGeneratedImagePart(p, messages[i].role))) {
			imageRank.set(i, rank++);
		}
	}

	return messages.map((message, index) => {
		const parts = (message.parts || []).flatMap((part: any): Part[] => {
			const { imageMeta, ...apiPart } = part;
			if (!isImagePart(part)) return [apiPart];

			const mode: ImageContextMode = imageMeta?.contextMode || 'auto';
			let keep: boolean;
			if (mode === 'pinned') keep = true;
			else if (mode === 'muted') keep = false;
			else if (!isGeneratedImagePart(part, message.role)) keep = true;
			else
				keep =
					index >= messages.length - recentMessages ||
					(imageRank.get(index) ?? Infinity) < recentImageTurns;

			return keep ? [apiPart] : [{ text: describeImage(part) }];
		});
		return { role: message.role, parts };
	});
};
