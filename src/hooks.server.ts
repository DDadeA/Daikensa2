// src/hooks.server.ts
import { json, type Handle } from '@sveltejs/kit';
import pool from '$lib/db'; // Adjust the import path as necessary

export const handle: Handle = async ({ event, resolve }) => {
	// api/로 시작하는 경로에 대해서만 검사를 수행합니다.
	if (event.url.pathname.startsWith('/api/')) {
		const { method } = event.request;

		// GET, POST, DELETE 요청에 대해서만 유효성 검사를 수행합니다.
		if (method === 'GET' || method === 'POST' || method === 'DELETE') {
			const passkey = event.request.headers.get('Authorization')?.split(' ')[1];

			if (!passkey) {
				return json({ message: '인증 토큰이 없습니다.' }, { status: 401 });
			}

			try {
				const dbResult = await pool.query('SELECT * FROM users WHERE passkey = $1', [passkey]);

				// 검증된 사용자 정보를 event.locals에 저장하여
				// +server.ts 파일에서 접근할 수 있도록 합니다.
				event.locals.user = dbResult.rows[0];
			} catch (error) {
				console.error('Database query error:', error);
				return json({ message: '유효하지 않은 토큰입니다.' }, { status: 401 });
			}
		}
	}

	// 유효성 검사를 통과했거나, 검사 대상이 아닌 경우 요청을 계속 진행합니다.
	const response = await resolve(event);
	return response;
};
