import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import pool from '$lib/db';
import { applyScratchpadAction, parseSettings } from '$lib/conversationOps';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const { conversation_id, action, content, target, replacement } = body;

	if (!conversation_id || !action) {
		return json({ error: 'conversation_id and action are required' }, { status: 400 });
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const res = await client.query(
			'SELECT settings FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE',
			[conversation_id, locals.user?.id ?? '']
		);
		if (res.rowCount === 0) {
			await client.query('ROLLBACK');
			return json({ error: 'Conversation not found' }, { status: 404 });
		}

		const settings = parseSettings(res.rows[0].settings);
		const current = typeof settings.scratchpad === 'string' ? settings.scratchpad : '';
		const next = applyScratchpadAction(current, { action, content, target, replacement });

		if (action !== 'read') {
			settings.scratchpad = next;
			await client.query('UPDATE conversations SET settings = $2::jsonb WHERE id = $1', [
				conversation_id,
				JSON.stringify(settings)
			]);
		}
		await client.query('COMMIT');
		return json({ scratchpad: next });
	} catch (error) {
		await client.query('ROLLBACK').catch(() => {});
		return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
	} finally {
		client.release();
	}
};
