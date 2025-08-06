export interface Conversation {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
}

export interface Message {
	id?: string;
	conversation_id: string; // Assuming messages are linked to conversations
	role: 'user' | 'model' | 'system'; // Assuming roles are either 'user' or 'model'
	content: string;
	metadata?: JSON;
	created_at?: string;
	updated_at?: string;
}
