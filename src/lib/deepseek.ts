// DeepSeek (OpenAI-compatible chat/completions) adapter.
// Messages are stored in Gemini format (Content/Part); this module converts to and from it.
// Kept free of browser/SvelteKit imports so it can be tested with plain node.

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export const deepseekModelList: string[] = [
	'deepseek-v4-pro',
	'deepseek-v4-flash',
	'deepseek-chat',
	'deepseek-reasoner'
];

export const isDeepseekModel = (modelName: string | undefined | null) =>
	!!modelName && modelName.startsWith('deepseek-');

type AnyPart = Record<string, any>;
type AnyContent = { role: string; parts?: AnyPart[] };

let idCounter = 0;
const makeCallId = () =>
	`call_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Gemini Tool[] -> OpenAI tools[]
export const geminiToolsToDeepseek = (tools: any[]) => {
	const lower = (schema: any): any => {
		if (Array.isArray(schema)) return schema.map(lower);
		if (schema && typeof schema === 'object') {
			const out: any = {};
			for (const [k, v] of Object.entries(schema)) {
				out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : lower(v);
			}
			return out;
		}
		return schema;
	};
	return (tools || [])
		.flatMap((t) => t.functionDeclarations || [])
		.map((fn: any) => ({
			type: 'function',
			function: {
				name: fn.name,
				description: fn.description,
				parameters: lower(fn.parameters) || { type: 'object', properties: {} }
			}
		}));
};

const mediaPlaceholder = (inlineData: any) => {
	const mime: string = inlineData?.mimeType || 'unknown';
	const kind = mime.split('/')[0];
	return `[${kind === 'image' ? 'Image' : kind === 'audio' ? 'Audio' : 'File'} attachment omitted: ${mime} (DeepSeek API accepts text only)]`;
};

const stringifyResponse = (response: any) => {
	if (response == null) return '';
	if (typeof response.output === 'string') return response.output;
	return typeof response === 'string' ? response : JSON.stringify(response);
};

// Gemini Content[] -> OpenAI messages[]
export const geminiContextToDeepseek = (context: AnyContent[], systemPrompt?: string) => {
	const messages: any[] = [];
	if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

	// Tool calls of the last assistant message that still wait for a result
	let pending: { id: string; name: string }[] = [];
	const flushPending = () => {
		for (const p of pending) {
			messages.push({ role: 'tool', tool_call_id: p.id, content: '(no result)' });
		}
		pending = [];
	};

	for (const content of context) {
		const parts = content.parts || [];
		const responses = parts.filter((p) => p.functionResponse);

		// Results answer the pending calls, then everything else follows
		for (const part of responses) {
			const fr = part.functionResponse;
			let idx = fr.id ? pending.findIndex((p) => p.id === fr.id) : -1;
			if (idx < 0) idx = pending.findIndex((p) => p.name === fr.name);
			if (idx < 0) {
				// Orphan result: keep the information as plain user text
				messages.push({
					role: 'user',
					content: `[Tool result: ${fr.name}]\n${stringifyResponse(fr.response)}`
				});
				continue;
			}
			const [match] = pending.splice(idx, 1);
			messages.push({
				role: 'tool',
				tool_call_id: match.id,
				content: stringifyResponse(fr.response)
			});
		}

		const rest = parts.filter((p) => !p.functionResponse);
		if (rest.length === 0) continue;
		flushPending();

		if (content.role === 'model') {
			const reasoning = rest
				.filter((p) => p.thought && p.text)
				.map((p) => p.text)
				.join('');
			const text = rest
				.filter((p) => p.text && !p.thought)
				.map((p) => p.text)
				.concat(rest.filter((p) => p.inlineData).map((p) => mediaPlaceholder(p.inlineData)))
				.join('\n');
			const calls = rest.filter((p) => p.functionCall?.name);

			const msg: any = { role: 'assistant', content: text || null };
			if (calls.length > 0) {
				msg.tool_calls = calls.map((p) => {
					const id = p.functionCall.id || makeCallId();
					pending.push({ id, name: p.functionCall.name });
					return {
						id,
						type: 'function',
						function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) }
					};
				});
				// Required by DeepSeek when thinking mode is combined with tool calls
				if (reasoning) msg.reasoning_content = reasoning;
			}
			if (!msg.content && !msg.tool_calls) continue;
			messages.push(msg);
		} else {
			const text = rest
				.map((p) => (p.inlineData ? mediaPlaceholder(p.inlineData) : p.text || ''))
				.filter(Boolean)
				.join('\n');
			if (text) messages.push({ role: 'user', content: text });
		}
	}
	flushPending();
	return messages;
};

export interface DeepseekOptions {
	model: string;
	thinking: boolean;
	effort?: string; // low/medium/high/max
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
}

export const buildDeepseekBody = (
	messages: any[],
	options: DeepseekOptions,
	tools?: any[]
) => {
	const body: any = {
		model: options.model,
		messages,
		max_tokens: options.maxTokens ?? 8192,
		thinking: { type: options.thinking ? 'enabled' : 'disabled' }
	};
	if (options.thinking) {
		// DeepSeek knows only high and max; lower levels map to high
		body.reasoning_effort = options.effort === 'max' ? 'max' : 'high';
	} else if (options.temperature !== undefined) {
		// temperature/top_p are ignored in thinking mode
		body.temperature = options.temperature;
	}
	if (tools && tools.length > 0) body.tools = tools;
	if (options.stream) {
		body.stream = true;
		body.stream_options = { include_usage: true };
	}
	return body;
};

const parseArgs = (raw: string | undefined) => {
	if (!raw || !raw.trim()) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return { _raw: raw };
	}
};

const assemble = (
	reasoning: string,
	text: string,
	calls: { id: string; name: string; args: string }[],
	includeThinking: boolean
): AnyPart[] => {
	const parts: AnyPart[] = [];
	// Reasoning must survive across tool-call turns even if the user hides it
	if (reasoning && (includeThinking || calls.length > 0)) parts.push({ text: reasoning, thought: true });
	if (text) parts.push({ text });
	for (const c of calls) {
		parts.push({ functionCall: { id: c.id || makeCallId(), name: c.name, args: parseArgs(c.args) } });
	}
	return parts;
};

// Non-streaming response -> Gemini parts
export const deepseekResponseToParts = (data: any, includeThinking: boolean) => {
	const message = data?.choices?.[0]?.message;
	if (!message) return { parts: [] as AnyPart[], totalTokens: data?.usage?.total_tokens ?? -1 };
	const calls = (message.tool_calls || []).map((c: any) => ({
		id: c.id,
		name: c.function?.name,
		args: c.function?.arguments
	}));
	return {
		parts: assemble(message.reasoning_content || '', message.content || '', calls, includeThinking),
		totalTokens: data?.usage?.total_tokens ?? -1
	};
};

// Incremental SSE parser. Feed decoded text; `onDelta` fires for visible text growth.
export const createDeepseekStreamAccumulator = (
	includeThinking: boolean,
	onDelta?: (kind: 'text' | 'reasoning', delta: string) => void
) => {
	let buffer = '';
	let reasoning = '';
	let text = '';
	let totalTokens = -1;
	let done = false;
	const calls: { id: string; name: string; args: string }[] = [];

	const handleLine = (line: string) => {
		if (!line.startsWith('data:')) return;
		const payload = line.slice(5).trim();
		if (!payload) return;
		if (payload === '[DONE]') {
			done = true;
			return;
		}
		let json: any;
		try {
			json = JSON.parse(payload);
		} catch {
			return;
		}
		if (json.usage?.total_tokens) totalTokens = json.usage.total_tokens;
		const delta = json.choices?.[0]?.delta;
		if (!delta) return;
		if (delta.reasoning_content) {
			reasoning += delta.reasoning_content;
			onDelta?.('reasoning', delta.reasoning_content);
		}
		if (delta.content) {
			text += delta.content;
			onDelta?.('text', delta.content);
		}
		for (const tc of delta.tool_calls || []) {
			const i = tc.index ?? 0;
			calls[i] ??= { id: '', name: '', args: '' };
			if (tc.id) calls[i].id = tc.id;
			if (tc.function?.name) calls[i].name += tc.function.name;
			if (tc.function?.arguments) calls[i].args += tc.function.arguments;
		}
	};

	return {
		push(chunk: string) {
			buffer += chunk;
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? '';
			lines.forEach(handleLine);
		},
		finish() {
			if (buffer) handleLine(buffer);
			buffer = '';
			return {
				parts: assemble(reasoning, text, calls.filter(Boolean), includeThinking),
				totalTokens,
				done
			};
		}
	};
};
