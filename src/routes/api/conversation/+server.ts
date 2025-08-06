import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import pool from '../db'; // Adjust the import path as necessary

/*
 * GET request handler for fetching conversations.
 * It retrieves conversations based on query parameters like `limit`.
 *
 * @param {Object} params - The request parameters.
 * @returns {Promise<Response>} - A JSON response containing the conversations or an error message.
 */
export const GET: RequestHandler = async ({ url }) => {
	// Handle GET request
	const searchParams = url.searchParams;

	// Message fetch Limit from query parameters
	const limit = searchParams.get('limit') || '100'; // Default limit to 100 if not provided

	// try {
	// Your GET logic here

	let data;

	const res = await pool.query('SELECT * FROM conversations LIMIT $1', [limit]);
	data = res.rows;

	return json(data);
	// } catch (error) {
	// 	return json({ error: error }, { status: 500 });
	// }
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
