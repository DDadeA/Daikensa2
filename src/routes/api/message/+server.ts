import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

import pool from '$lib/db'; // Adjust the import path as necessary
import type { Message } from '$lib/types';

export const GET: RequestHandler = async ({ url }) => {
	// Handle GET request
	const searchParams = url.searchParams;

	// Message fetch Limit from query parameters
	const conversation_id = searchParams.get('conversation_id');
	const limit = searchParams.get('limit') || '1000'; // Default limit to 100 if not provided

	if (!conversation_id) {
		return json({ error: 'Conversation ID is required' }, { status: 400 });
	}

	try {
		let data;

		const res = await pool.query(
			'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2',
			[conversation_id, limit]
		);
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
		const { id, conversation_id, parts, role } = body as Message;

		if (!id || !conversation_id || parts == undefined || !role) {
			return json({ error: 'ID, Conversation ID, parts, and role are required' }, { status: 400 });
		}

		console.log('Received POST request: parts:', JSON.stringify(parts));
		console.log('Received POST request: role:', JSON.stringify(role));

		const res = await pool.query(
			'INSERT INTO messages (id, conversation_id, parts, role) VALUES ($1, $2, $3, $4) RETURNING *',
			[id, conversation_id, parts ? JSON.stringify(parts) : null, role]
		);

		const newMessage = res.rows[0];

		return json({ message: 'Message sent successfully', data: newMessage }, { status: 201 });
	} catch (error) {
		return json({ error: error }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	// Handle DELETE request
	try {
		const body = await request.json();
		const { id } = body as { id: string };

		if (!id) {
			return json({ error: 'ID is required' }, { status: 400 });
		}

		const res = await pool.query('DELETE FROM messages WHERE id = $1 RETURNING *', [id]);

		if (res.rowCount === 0) {
			return json({ error: 'Message not found' }, { status: 404 });
		}

		return json({ message: 'Message deleted successfully', data: res.rows[0] }, { status: 200 });
	} catch (error) {
		return json({ error: 'Failed to process DELETE request' }, { status: 500 });
	}
};
