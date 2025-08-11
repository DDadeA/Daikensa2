// src/lib/api.ts
import { browser } from '$app/environment';

// 브라우저 환경에서만 localStorage에 접근 가능하도록 확인
const getToken = () => {
	if (browser) {
		return localStorage.getItem('authToken');
	}
	return null;
};

// 기본 fetch를 감싸는 새로운 함수
export const apiFetch = async (url: string, options: RequestInit = {}) => {
	const token = getToken();

	const baseHeaders: any = {
		'Content-Type': 'application/json',
		...options.headers // 기존 헤더를 유지하면서 확장
	};

	if (token) {
		baseHeaders['Authorization'] = `Bearer ${token}`;
	}

	const response = await fetch(url, {
		...options,
		headers: baseHeaders
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
	}

	return response.json();
};
