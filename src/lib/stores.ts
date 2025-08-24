import { writable } from 'svelte/store';
export let streamingText = writable<string>('');
export let nai_api_key = writable<string>('');
// export let nai_api_key = '';
