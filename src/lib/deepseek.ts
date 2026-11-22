// DeepSeek (OpenAI-compatible chat/completions) adapter.
// Spec: https://api-docs.deepseek.com (models, thinking_mode, tool_calls, vision, web_tools, asr)
// Messages are stored in Gemini format (Content/Part); this module converts to and from it.
// Kept free of browser/SvelteKit imports so it can be tested with plain node.

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_ASR_ENDPOINT = 'https://api.deepseek.com/v1/tools/asr';

export const deepseekModelList: string[] = ['deepseek-flash', 'deepseek-v4-pro'];

export const isDeepseekModel = (modelName: string | undefined | null) =>
    !!modelName && modelName.startsWith('deepseek-');

// Legacy names are still accepted by the API but retired
export const normalizeDeepseekModel = (modelName: string) =>
    modelName === 'deepseek-v4-flash' || modelName === 'deepseek-v4-flash-vision-exp'
        ? 'deepseek-flash'
        : modelName;

// Only deepseek-flash takes images, and only it supports the server web tools
export const deepseekSupportsVision = (modelName: string) =>
    normalizeDeepseekModel(modelName) === 'deepseek-flash';
export const deepseekSupportsWebTools = deepseekSupportsVision;

export const DEEPSEEK_WEB_TOOLS = [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }];

// Part.deepseek holds provider data that Gemini must never see (stripped in context.ts)
export interface DeepseekPartData {
    reasoning?: boolean; // the part is DeepSeek reasoning_content (folded away in the UI)
    serverToolCalls?: any[];
}

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

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const mediaPlaceholder = (inlineData: any, why: string) => {
    const mime: string = inlineData?.mimeType || 'unknown';
    const kind = mime.split('/')[0];
    return `[${kind === 'image' ? 'Image' : kind === 'audio' ? 'Audio' : 'File'} attachment omitted: ${mime} (${why})]`;
};

const toDataUrl = (inlineData: any) => {
    const data: string = inlineData.data || '';
    return data.startsWith('data:') ? data : `data:${inlineData.mimeType};base64,${data}`;
};

const stringifyResponse = (response: any) => {
    if (response == null) return '';
    if (typeof response.output === 'string') return response.output;
    return typeof response === 'string' ? response : JSON.stringify(response);
};

export interface ContextOptions {
    systemPrompt?: string;
    // Model accepts image_url blocks (user messages only; images in assistant messages are a 400)
    vision?: boolean;
    // Thinking mode AND a tools parameter: every earlier assistant message must carry reasoning_content
    passBackReasoning?: boolean;
    // inlineData audio data -> transcript (resolved beforehand with ASR)
    transcripts?: Map<string, string>;
}

// Gemini Content[] -> OpenAI messages[]
export const geminiContextToDeepseek = (context: AnyContent[], options: ContextOptions = {}) => {
    const { systemPrompt, vision = false, passBackReasoning = false, transcripts } = options;
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

    // user-side parts -> plain text, or a content-block array when an image is present
    const userContent = (parts: AnyPart[]) => {
        const blocks: any[] = [];
        for (const p of parts) {
            if (p.inlineData) {
                const mime: string = p.inlineData.mimeType || '';
                const transcript = transcripts?.get(p.inlineData.data);
                if (mime.startsWith('audio/') && transcript !== undefined) {
                    blocks.push({ type: 'text', text: `[Voice message transcript] ${transcript}` });
                } else if (vision && IMAGE_MIMES.includes(mime)) {
                    blocks.push({ type: 'image_url', image_url: { url: toDataUrl(p.inlineData) } });
                } else {
                    const why = mime.startsWith('image/')
                        ? vision
                            ? 'only JPEG, PNG, GIF and WebP are supported'
                            : 'this DeepSeek model has no vision'
                        : mime.startsWith('audio/')
                            ? 'audio could not be transcribed'
                            : 'DeepSeek chat accepts text and images only';
                    blocks.push({ type: 'text', text: mediaPlaceholder(p.inlineData, why) });
                }
            } else if (p.text) {
                blocks.push({ type: 'text', text: p.text });
            }
        }
        if (blocks.length === 0) return null;
        return blocks.every((b) => b.type === 'text') ? blocks.map((b) => b.text).join('\n') : blocks;
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
                .join('\n');
            const calls = rest.filter((p) => p.functionCall?.name);
            const serverToolCalls = rest.find((p) => p.deepseek?.serverToolCalls)?.deepseek
                .serverToolCalls;
            // Assistant messages cannot hold images: generated images follow as a user message
            const images = rest.filter((p) => p.inlineData);

            if (text || calls.length > 0) {
                const msg: any = { role: 'assistant', content: text || null };
                if (calls.length > 0) {
                    msg.tool_calls = calls.map((p) => {
                        const id = p.functionCall.id || makeCallId();
                        pending.push({ id, name: p.functionCall.name });
                        return {
                            id,
                            type: 'function',
                            function: {
                                name: p.functionCall.name,
                                arguments: JSON.stringify(p.functionCall.args || {})
                            }
                        };
                    });
                }
                if (serverToolCalls) msg.server_tool_calls = serverToolCalls;
                // With tools in the request, a missing reasoning_content on any assistant message is a 400
                if (passBackReasoning || (reasoning && calls.length > 0)) msg.reasoning_content = reasoning;
                messages.push(msg);
            }
            if (images.length > 0) {
                const flat = images.flatMap((p) => {
                    const c = userContent([p]);
                    return typeof c === 'string' ? [{ type: 'text', text: c }] : c || [];
                });
                if (flat.length > 0) {
                    messages.push({
                        role: 'user',
                        content: [{ type: 'text', text: '[Media generated by the assistant]' }, ...flat]
                    });
                }
            }
        } else {
            const c = userContent(rest);
            if (c) messages.push({ role: 'user', content: c });
        }
    }
    flushPending();
    return messages;
};

export interface DeepseekOptions {
    model: string;
    thinking: boolean;
    effort?: string; // low/medium/high/max (Gemini names are accepted and mapped)
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
}

// low -> low, max -> max, everything else (medium/high/...) -> high
export const mapEffort = (effort?: string) =>
    effort === 'low' || effort === 'max' ? effort : 'high';

export const buildDeepseekBody = (messages: any[], options: DeepseekOptions, tools?: any[]) => {
    const body: any = {
        model: normalizeDeepseekModel(options.model),
        messages,
        thinking: { type: options.thinking ? 'enabled' : 'disabled' }
    };
    // Server defaults are 8K (non-thinking) and 64K (thinking), so only send an explicit value
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.thinking) {
        body.reasoning_effort = mapEffort(options.effort);
    } else if (options.temperature !== undefined) {
        // temperature has no effect in thinking mode
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
    serverToolCalls?: any[]
): AnyPart[] => {
    const parts: AnyPart[] = [];
    // Always kept: it has to be sent back when tools are used. The UI folds it away.
    if (reasoning) parts.push({ text: reasoning, thought: true, deepseek: { reasoning: true } });
    if (text) {
        const textPart: AnyPart = { text };
        if (serverToolCalls?.length) textPart.deepseek = { serverToolCalls };
        parts.push(textPart);
    }
    for (const c of calls) {
        parts.push({ functionCall: { id: c.id || makeCallId(), name: c.name, args: parseArgs(c.args) } });
    }
    return parts;
};

export interface DeepseekResult {
    parts: AnyPart[];
    totalTokens: number;
    finishReason?: string;
    error?: string;
}

// Non-streaming response -> Gemini parts
export const deepseekResponseToParts = (data: any): DeepseekResult => {
    const totalTokens = data?.usage?.total_tokens ?? -1;
    if (data?.error) {
        return { parts: [], totalTokens, error: data.error.message || JSON.stringify(data.error) };
    }
    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (!message) return { parts: [], totalTokens };
    const calls = (message.tool_calls || []).map((c: any) => ({
        id: c.id,
        name: c.function?.name,
        args: c.function?.arguments
    }));
    return {
        parts: assemble(
            message.reasoning_content || '',
            message.content || '',
            calls,
            message.server_tool_calls
        ),
        totalTokens,
        finishReason: choice.finish_reason
    };
};

// Incremental SSE parser. Feed decoded text; `onDelta` fires for visible text growth.
export const createDeepseekStreamAccumulator = (
    onDelta?: (kind: 'text' | 'reasoning', delta: string) => void
) => {
    let buffer = '';
    let reasoning = '';
    let text = '';
    let totalTokens = -1;
    let finishReason: string | undefined;
    let error: string | undefined;
    let serverToolCalls: any[] | undefined;
    const calls: { id: string; name: string; args: string }[] = [];

    const handleLine = (line: string) => {
        if (!line.startsWith('data:')) return; // also skips ": keep-alive" comments
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let json: any;
        try {
            json = JSON.parse(payload);
        } catch {
            return;
        }
        if (json.error) error = json.error.message || JSON.stringify(json.error);
        if (json.usage?.total_tokens) totalTokens = json.usage.total_tokens;
        const choice = json.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta;
        if (!delta) return;
        if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onDelta?.('reasoning', delta.reasoning_content);
        }
        if (delta.content) {
            text += delta.content;
            onDelta?.('text', delta.content);
        }
        // The complete list arrives once, in the last chunk
        if (delta.server_tool_calls) serverToolCalls = delta.server_tool_calls;
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
        finish(): DeepseekResult {
            if (buffer) handleLine(buffer);
            buffer = '';
            return {
                parts: assemble(reasoning, text, calls.filter(Boolean), serverToolCalls),
                totalTokens,
                finishReason,
                error
            };
        }
    };
};

// 16-bit PCM mono WAV (DeepSeek ASR accepts WAV 8k-48k Hz, <= 8 MiB, <= 120 s)
export const ASR_MAX_SECONDS = 120;
export const ASR_SAMPLE_RATE = 16000;

export const encodeWav = (samples: Float32Array, sampleRate: number): Uint8Array => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) =>
        [...s].forEach((ch, i) => view.setUint8(off + i, ch.charCodeAt(0)));
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buffer);
};
