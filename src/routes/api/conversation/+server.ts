import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import pool from '$lib/db'; // Adjust the import path as necessary

/*
 * GET request handler for fetching conversations.
 * It retrieves conversations based on query parameters like `limit`.
 *
 * @param {Object} params - The request parameters.
 * @returns {Promise<Response>} - A JSON response containing the conversations or an error message.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	// Handle GET request
	const searchParams = url.searchParams;

	// Message fetch Limit from query parameters
	const limit = searchParams.get('limit') || '1000'; // Default limit to 100 if not provided

	const user_id = locals.user ? locals.user.id : '';

	const res = await pool.query(
		'SELECT * FROM conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
		[user_id, limit]
	);

	return json(res.rows);
	// } catch (error) {
	// 	return json({ error: error }, { status: 500 });
	// }
};

export const POST: RequestHandler = async ({ request, locals }) => {
	// Handle POST request
	try {
		const body = await request.json();

		// id, title, setting
		const { id, title, settings: settings } = body;

		console.log('Received POST request: id:', JSON.stringify(id));
		// console.log('Received POST request: title:', JSON.stringify(title));
		// console.log('Received POST request: setting:', JSON.stringify(settings));

		if (!id || !title || !settings) {
			return json({ error: 'ID, title, and setting are required' }, { status: 400 });
		}

		const user_id = locals.user ? locals.user.id : null;

		// INSERT or UPDATE
		const res = await pool.query(
			'INSERT INTO conversations (id, title, user_id, settings) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, user_id = EXCLUDED.user_id, settings = EXCLUDED.settings RETURNING *',
			[id, title, user_id, settings]
		);

		return json(res.rows);
	} catch (error) {
		return json({ error: 'Failed to process POST request' }, { status: 500 });
	}
};
