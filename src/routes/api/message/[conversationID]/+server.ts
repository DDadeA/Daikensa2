import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import pool from '../../db';

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

		// Your POST logic here
		const result = { message: 'POST request successful', received: body };
		return json(result);
	} catch (error) {
		return json({ error: 'Failed to process POST request' }, { status: 500 });
	}
};
