import { FunctionCallingConfigMode, Type, Behavior } from '@google/genai';
import type { CallableTool, FunctionCall, FunctionDeclaration, Tool } from '@google/genai';

export const tools: Tool[] = [
	{
		functionDeclarations: [
			{
				// behavior: Behavior.BLOCKING,
				name: 'eval',
				description: 'Evaluate a JavaScript expression and return the console.log() output.',
				parameters: {
					type: Type.OBJECT,
					properties: {
						expression: {
							type: Type.STRING,
							description: 'The JavaScript expression to evaluate.'
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
	eval: async (params: { expression: string }) => {
		return {
			result: (() => {
				// From now, all logs will be captured
				const originalConsoleLog = console.log;
				let capturedLogs: string[] = [];
				console.log = (...args: any[]) => {
					originalConsoleLog.apply(console, args);
					capturedLogs.push(args.join(' '));
				};

				eval(params.expression);

				// Restore original console.log
				console.log = originalConsoleLog;

				// Return the logs
				return capturedLogs;
			})()
		};
	}
};

export const toolConfig = {
	// functionCallingConfig: {
	// 	allowedFunctionNames: ['alert', 'eval'],
	// 	mode: FunctionCallingConfigMode.ANY
	// }
};
