import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

import pool from '$lib/db'; // Adjust the import path as necessary
import type { Message } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	// Handle POST request
	try {
		const body = await request.json();
		const { id, conversation_id, content, role, metadata } = body as Message;

		if (!id || !conversation_id || !content || !role) {
			return json(
				{ error: 'ID, Conversation ID, content, and role are required' },
				{ status: 400 }
			);
		}

		const res = await pool.query(
			'INSERT INTO messages (id, conversation_id, content, role, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',
			[id, conversation_id, content, role, metadata ? JSON.stringify(metadata) : null]
		);

		const newMessage = res.rows[0];

		return json({ message: 'Message sent successfully', data: newMessage }, { status: 201 });
	} catch (error) {
		return json({ error: 'Failed to process POST request' }, { status: 500 });
	}
};
