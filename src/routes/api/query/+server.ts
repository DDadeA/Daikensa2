import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

import pool from '$lib/db'; // Adjust the import path as necessary
import type { Message } from '$lib/types';

export const GET: RequestHandler = async ({ url }) => {
	// Handle GET request
	const searchParams = url.searchParams;

	const query = searchParams.get('query');

	if (!query) {
		return json({ error: 'Query is required' }, { status: 400 });
	}

	try {
		let data;

		const res = await pool.query(query);

		return json({ result: res });
	} catch (error) {
		return json({ error: error }, { status: 500 });
	}
};
