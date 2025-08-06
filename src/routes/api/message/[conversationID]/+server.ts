import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import pool from '$lib/db';
import type { Message } from '$lib/types';

export const GET: RequestHandler = async ({ url, params }) => {
	// Handle GET request
	const searchParams = url.searchParams;

	// Extract conversationID from params
	const conversationID = params?.conversationID;
	if (!conversationID) {
		return json({ error: 'Conversation ID is required' }, { status: 400 });
	}

	// Message fetch Limit from query parameters
	const limit = searchParams.get('limit') || '100'; // Default limit to 100 if not provided

	try {
		let data;

		const res = await pool.query('SELECT * FROM messages WHERE conversation_id = $1 LIMIT $2', [
			conversationID,
			limit
		]);
		data = res.rows;

		return json({ rows: data });
	} catch (error) {
		return json({ error: 'Failed to process GET request' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	// Handle POST request
	try {
		const body = await request.json();
		const { conversation_id, content, role, metadata } = body as Message;

		if (!conversation_id || !content || !role) {
			return json({ error: 'Conversation ID, content, and role are required' }, { status: 400 });
		}

		const res = await pool.query(
			'INSERT INTO messages (conversation_id, content, role, metadata) VALUES ($1, $2, $3, $4) RETURNING *',
			[conversation_id, content, role, metadata ? JSON.stringify(metadata) : null]
		);

		const newMessage = res.rows[0];

		return json({ message: 'Message sent successfully', data: newMessage }, { status: 201 });
	} catch (error) {
		return json({ error: 'Failed to process POST request' }, { status: 500 });
	}
};
