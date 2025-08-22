import { FunctionCallingConfigMode, Type, Behavior } from '@google/genai';
import type { CallableTool, FunctionCall, FunctionDeclaration, Tool } from '@google/genai';
import { writable } from 'svelte/store';
import { apiFetch } from '$lib/api';

export const tools: Tool[] = [
	{
		functionDeclarations: [
			{
				// behavior: Behavior.BLOCKING,
				name: 'javascript',
				description: 'Run a JavaScript expression and return the console.log() output.',
				parameters: {
					type: Type.OBJECT,
					properties: {
						expression: {
							type: Type.STRING,
							description: 'The JavaScript expression to run.'
						}
					},
					required: ['expression']
				}
			},
			{
				// behavior: Behavior.BLOCKING,
				name: 'alert',
				description: 'Please do not use this tool excessively.',
				parameters: {
					type: Type.OBJECT,
					properties: {
						message: {
							type: Type.STRING,
							description: 'The message to display in the alert.'
						}
					},
					required: ['message']
				}
			},
			{
				name: 'choice',
				description:
					"Give the user choices to select from. It's better to use this tool when you need user input but user cannot type freely.",
				parameters: {
					type: Type.OBJECT,
					properties: {
						choices: {
							type: Type.ARRAY,
							items: {
								type: Type.STRING,
								description: 'A choice for the user to select.'
							},
							description: 'An array of choices for the user to select from.'
						}
					},
					required: ['choices']
				}
			},
			{
				name: 'query',
				description: 'Run a SQL query and return the result.',
				parameters: {
					type: Type.OBJECT,
					properties: {
						query: {
							type: Type.STRING,
							description: 'The SQL query to run.'
						}
					},
					required: ['query']
				}
			}
		] as FunctionDeclaration[]
	}
];

export const actualTool = {
	alert: async (params: { message: string }) => {
		alert(params.message);
		return {
			confirmation: 'Alert displayed successfully. (Surely Do not spam this. User hate it)'
		};
	},
	javascript: async (params: { expression: string }) => {
		return {
			result: (() => {
				// From now, all logs will be captured
				const originalConsoleLog = console.log;
				let capturedLogs: string[] = [];
				console.log = (...args: any[]) => {
					originalConsoleLog.apply(console, args);
					capturedLogs.push(args.join(' '));
				};

				try {
					// eval(params.expression.replaceAll('\\n', '\n'));
					let targetFunction = new Function(params.expression);
					targetFunction();
				} catch (error) {
					capturedLogs.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
				}

				// Restore original console.log
				console.log = originalConsoleLog;

				// Return the logs
				return {
					confirmation: capturedLogs
				};
			})()
		};
	},
	choice: async (params: { choices: string[] }) => {
		isAskingChoice.set(true);

		await new Promise<void>((resolve) => {
			handleChoice = (choice: string) => {
				choosenOption = choice;
				isAskingChoice.set(false);
				resolve();
			};
			cancelToolAwait = () => {
				isAskingChoice.set(false);
				choosenOption = null;
				resolve();
			};
			choiceOptions.set(params.choices);
		});

		if (choosenOption === null) {
			return null;
		}

		return {
			confirmation: `User selected: ${choosenOption}`
		};
	},
	query: async (params: { query: string }) => {
		let res = await apiFetch(`/api/query?query=${encodeURIComponent(params.query)}`);
		return {
			confirmation: JSON.stringify(res, null, 2)
		};
	}
};

// export let isAskingChoice = false;
export let isAskingChoice = writable<boolean>(false);
export let choiceOptions = writable<string[]>([]);
let choosenOption: string | null = null;
export let handleChoice = (choice: string) => {};
export let cancelToolAwait = () => {};

export const toolConfig = {
	// functionCallingConfig: {
	// 	allowedFunctionNames: ['alert', 'eval'],
	// 	mode: FunctionCallingConfigMode.ANY
	// }
};
