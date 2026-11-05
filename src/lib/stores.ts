import { writable } from 'svelte/store';
export let streamingText = writable<string>('');
export let nai_api_key = writable<string>('');
// export let nai_api_key = '';
export let currentConversationId = writable<string>('');
// Latest scratchpad text written by a tool (consumed by the page to sync local state)
export let scratchpadUpdate = writable<{ conversationId: string; text: string } | null>(null);
// Incremented when tools create/modify conversations so the page reloads the list
export let conversationsChanged = writable<number>(0);
