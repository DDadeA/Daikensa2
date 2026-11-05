import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import pool from '$lib/db';
import { parseSettings, rewriteSessionAnchor } from '$lib/conversationOps';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const { conversation_id, nextTitle, sessionSummary, scratchpadUpdate } = body;

	if (!conversation_id || !nextTitle || typeof sessionSummary !== 'string') {
		return json(
			{ error: 'conversation_id, nextTitle and sessionSummary are required' },
			{ status: 400 }
		);
	}

	const userId = locals.user?.id ?? '';
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const res = await client.query(
			'SELECT title, settings FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE',
			[conversation_id, userId]
		);
		if (res.rowCount === 0) {
			await client.query('ROLLBACK');
			return json({ error: 'Conversation not found' }, { status: 404 });
		}

		const prevTitle: string = res.rows[0].title;
		const settings = parseSettings(res.rows[0].settings);
		const basePrompt: string = settings.systemPrompt || '';
		const updatedPrompt = basePrompt ? `${basePrompt}\n${sessionSummary}` : sessionSummary;

		// 1. Append the summary to the current session
		await client.query('UPDATE conversations SET settings = $2::jsonb WHERE id = $1', [
			conversation_id,
			JSON.stringify({ ...settings, systemPrompt: updatedPrompt })
		]);

		// 2. Clone settings into a fresh session (no messages are copied)
		const nextSettings: Record<string, any> = {
			...settings,
			systemPrompt: rewriteSessionAnchor(updatedPrompt, prevTitle, nextTitle)
		};
		if (typeof scratchpadUpdate === 'string') nextSettings.scratchpad = scratchpadUpdate;

		const newConversationId = randomUUID();
		await client.query(
			'INSERT INTO conversations (id, title, user_id, settings) VALUES ($1, $2, $3, $4::jsonb)',
			[newConversationId, nextTitle, userId, JSON.stringify(nextSettings)]
		);

		await client.query('COMMIT');
		return json({ success: true, prevTitle, nextTitle, newConversationId });
	} catch (error) {
		await client.query('ROLLBACK').catch(() => {});
		return json(
			{ success: false, error: error instanceof Error ? error.message : String(error) },
			{ status: 500 }
		);
	} finally {
		client.release();
	}
};
