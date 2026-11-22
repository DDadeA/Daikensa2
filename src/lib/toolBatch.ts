import type { Part } from '@google/genai';

// Several tool calls in one model turn:
// 1. They start together and get a short grace window (calls of the same tool queue on a lane).
// 2. What finished in time is squeezed into ONE user message, one functionResponse per call, in call order.
// 3. A call that is still running moves to the background; its slot in that message says so.
// 4. A background result is delivered later: attached to the next tool-return message, or sent on its
//    own once nothing else is going on.

export const TOOL_BATCH_GRACE_MS = 4000;
export const LATE_DELIVERY_RETRY_MS = 2000;

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
	promise.then(
		(value) => ({ ok: true as const, value }),
		(error) => ({ ok: false as const, error })
	);

export type BatchOutcome<T> =
	| { status: 'done'; value: T }
	| { status: 'error'; error: unknown }
	| { status: 'background'; settled: Promise<Settled<T>> };

export interface BatchCall<T> {
	lane: string; // calls on the same lane run one after another, lanes run in parallel
	run: () => Promise<T>;
}

// Never throws. Calls unfinished after graceMs come back as 'background' with a promise for their result.
export const runBatch = async <T>(
	calls: BatchCall<T>[],
	graceMs: number
): Promise<BatchOutcome<T>[]> => {
	const tails = new Map<string, Promise<unknown>>();
	const settled = calls.map((call) => {
		const previous = tails.get(call.lane) ?? Promise.resolve();
		const next = settle(previous.then(() => call.run()));
		tails.set(call.lane, next);
		return next;
	});

	const results: (Settled<T> | undefined)[] = calls.map(() => undefined);
	settled.forEach((promise, i) => {
		promise.then((result) => {
			results[i] = result;
		});
	});

	const all = Promise.all(settled);
	if (Number.isFinite(graceMs)) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			all,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, Math.max(0, graceMs));
			})
		]);
		clearTimeout(timer);
	} else {
		await all;
	}

	return results.map((result, i): BatchOutcome<T> => {
		if (!result) return { status: 'background', settled: settled[i] };
		return result.ok
			? { status: 'done', value: result.value }
			: { status: 'error', error: result.error };
	});
};

export interface ToolResultLike {
	sendBack: boolean;
	role?: string;
	data: any;
}

export const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const functionResponse = (name: string, output: string) => ({
	functionResponse: { name, response: { output } }
});

const outputOf = (data: any): string => {
	const response = data?.functionResponse?.response;
	if (response == null) return '';
	return typeof response.output === 'string' ? response.output : JSON.stringify(response);
};

export const backgroundNotice = (taskId: string, name: string, graceMs: number) =>
	`[Moved to background as task ${taskId}: ${name} did not finish within ${Math.round(graceMs / 1000)}s and is still running. ` +
	`Its result will arrive later in a separate message that starts with "[Background task ${taskId}". ` +
	`Continue with the other results and do not guess this one.]`;

export interface SqueezedBatch {
	parts: Part[];
	sendBack: boolean;
	taskIds: (string | null)[]; // per call: task id when it went to the background
}

// Outcomes -> the parts of the single user message that answers all calls.
export const squeezeOutcomes = (
	calls: { name: string }[],
	outcomes: BatchOutcome<ToolResultLike | null>[],
	graceMs: number,
	newTaskId: () => string
): SqueezedBatch => {
	const responses: any[] = [];
	const media: any[] = [];
	const taskIds: (string | null)[] = [];
	let sendBack = false;

	outcomes.forEach((outcome, i) => {
		const name = calls[i].name;
		taskIds.push(null);

		if (outcome.status === 'background') {
			const taskId = newTaskId();
			taskIds[i] = taskId;
			responses.push(functionResponse(name, backgroundNotice(taskId, name, graceMs)));
			sendBack = true; // the model has to learn that this work is still running
		} else if (outcome.status === 'error') {
			responses.push(functionResponse(name, `Error: ${errorMessage(outcome.error)}`));
			sendBack = true;
		} else if (!outcome.value) {
			responses.push(functionResponse(name, 'Skipped: no result (cancelled by the user).'));
		} else if (outcome.value.data?.functionResponse) {
			responses.push(outcome.value.data);
			sendBack ||= outcome.value.sendBack;
		} else {
			// Media such as a generated image: every call still needs its response
			responses.push(
				functionResponse(name, 'Done. The generated media is attached after the tool responses.')
			);
			media.push(outcome.value.data);
			sendBack ||= outcome.value.sendBack;
		}
	});

	return { parts: [...responses, ...media], sendBack, taskIds };
};

export interface LateItem {
	conversationId: string;
	parts: Part[];
	sendBack: boolean;
}

// A finished background call -> what to tell the model (null: nothing to deliver).
export const lateItemFrom = (
	info: { taskId: string; name: string; conversationId: string; elapsedMs: number },
	settled: Settled<ToolResultLike | null>
): LateItem | null => {
	const seconds = Math.round(info.elapsedMs / 1000);
	if (!settled.ok) {
		return {
			conversationId: info.conversationId,
			sendBack: true,
			parts: [
				{
					text: `[Background task ${info.taskId} failed: ${info.name} after ${seconds}s]\n${errorMessage(settled.error)}`
				}
			]
		};
	}
	const result = settled.value;
	if (!result) return null; // e.g. a choice the user cancelled
	const header = `[Background task ${info.taskId} completed: ${info.name} after ${seconds}s]`;
	const parts: Part[] = result.data?.functionResponse
		? [{ text: `${header}\n${outputOf(result.data)}` }]
		: [{ text: header }, result.data];
	return { conversationId: info.conversationId, sendBack: result.sendBack, parts };
};

// Holds finished background results until they can be delivered without cutting into anything.
export const createLateDelivery = (options: {
	isBusy: () => boolean;
	deliver: (conversationId: string, parts: Part[], sendBack: boolean) => void;
	retryMs?: number;
}) => {
	const retryMs = options.retryMs ?? LATE_DELIVERY_RETRY_MS;
	let items: LateItem[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	const schedule = () => {
		if (timer || items.length === 0) return;
		timer = setTimeout(flush, retryMs);
	};

	const flush = () => {
		timer = null;
		if (items.length === 0) return;
		if (options.isBusy()) return schedule(); // streaming / tools running: try again in a moment

		const batch = items;
		items = [];
		const byConversation = new Map<string, LateItem[]>();
		for (const item of batch) {
			byConversation.set(item.conversationId, [...(byConversation.get(item.conversationId) ?? []), item]);
		}
		for (const [conversationId, group] of byConversation) {
			options.deliver(
				conversationId,
				group.flatMap((item) => item.parts),
				group.some((item) => item.sendBack)
			);
		}
	};

	return {
		push(item: LateItem) {
			items.push(item);
			schedule();
		},
		// Removes the waiting results of a conversation so they can ride along with a tool-return message
		take(conversationId: string): { parts: Part[]; sendBack: boolean } {
			const taken = items.filter((item) => item.conversationId === conversationId);
			items = items.filter((item) => item.conversationId !== conversationId);
			return {
				parts: taken.flatMap((item) => item.parts),
				sendBack: taken.some((item) => item.sendBack)
			};
		},
		get pending() {
			return items.length;
		}
	};
};
