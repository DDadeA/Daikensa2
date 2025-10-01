import type { Part } from '@google/genai';
export interface Conversation {
	id: string;
	title: string;
	user_id?: string;
	created_at: string;
	updated_at: string;
	settings?: {
		systemPrompt?: string;
	};
}

export interface Message {
	id?: string;
	conversation_id: string; // Assuming messages are linked to conversations
	role: 'user' | 'model';
	parts?: Part[];
	created_at?: string;
	updated_at?: string;
	streamingText?: string;
}
