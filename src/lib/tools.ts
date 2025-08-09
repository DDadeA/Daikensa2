import { FunctionCallingConfigMode, Type, Behavior } from '@google/genai';
import type { CallableTool, FunctionCall, FunctionDeclaration, Tool } from '@google/genai';

export const toolConfig = {
	functionCallingConfig: {
		// allowedFunctionNames: [],
		mode: FunctionCallingConfigMode.ANY
	}
};

const alertTool: Tool = {
	functionDeclarations: [
		{
			behavior: Behavior.BLOCKING,
			name: 'alert',
			description:
				'Display an alert message and return a confirmation. Please do not use in normal conversation, this is just for testing purposes.',
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
};

export const actualTool = {
	alert: async (params: { message: string }) => {
		alert(params.message);
		return { confirmation: 'Alert displayed successfully' };
	}
};

export const tools = []; //[alertTool];
