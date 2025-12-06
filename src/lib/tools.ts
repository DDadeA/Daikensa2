import { FunctionCallingConfigMode, Type, Behavior } from '@google/genai';
import type { CallableTool, FunctionCall, FunctionDeclaration, Tool } from '@google/genai';
import JSZip from 'jszip';

import { writable } from 'svelte/store';
import { apiFetch } from '$lib/api';
import { get } from 'svelte/store';
import { nai_api_key } from '$lib/stores';

const PROMPT_TEMPLATE = `
If 대현자 wants to show, draw, or generate an anime-style image, follow the prompt formatting guideline below.
대현자 are assisting a text-to-image diffusion model (like Stable Diffusion or NovelAI) that interprets **flat, tag-style prompts**, not full natural language. Your task is to convert user requests into concise, visually descriptive prompts using comma-separated keywords.

---
### 📌 Prompt Construction Guide

1. **Do NOT write full sentences.**  
   Use short, descriptive phrases or single keywords.

2. **Use comma-separated tags.**  
   These represent visual elements that should co-occur in the image.

3. **Include the following categories when possible** (in any order):
   - \`Character Count & Type\`: e.g., \`1girl\`, \`2boys\`
   - \`Pose or Action\`: e.g., \`sitting on bench\`, \`holding gift\`
   - \`Facial Expression\`: e.g., \`smiling\`, \`blushing\`, \`crying\`
   - \`Hair\`: style, length, color (e.g., \`long black hair\`, \`ponytail\`)
   - \`Eyes\`: shape and color (e.g., \`golden eyes\`, \`narrow eyes\`)
   - \`Outfit\`: clothing type, color, accessories (e.g., \`school uniform\`, \`maid outfit\`)
   - \`Perspective\`: e.g., \`close-up\`, \`overhead view\`, \`profile view\`
   - \`Scene/Background\`: e.g., \`classroom\`, \`japanese bedroom\`, \`forest at night\`
   - \`Lighting/Mood\`: e.g., \`soft lighting\`, \`sunset glow\`, \`dramatic shadows\`

4. **Avoid abstract logic**, such as \`(source#give item)\` or narrative explanations. Instead, express visually observable actions: \`giving gift\`, \`receiving present\`.

5. **If the user describes a full scene**, break it down into visual tags following the above structure.


## Positive prompt template (quality prompt, please include these keywords except the special cases (skip eye related tags when eyes should not be visible))
\`\`\`
{{{masterpiece}}}, {{{best quality}}}, {{amazing quality}}, {{{4k}}}, {{{High definition}}}, {{aesthetic}}, {{spectacular shadow}}, ,{{{shiny skin}}}, {{{{{{{beautiful light}}}}}}}, {{{{Vivid and realistic eyes, sharp and detailed irises, natural iris patterns, delicate and defined eyelashes, reflective highlights in the eyes, smooth and realistic eyelids, emotionally expressive gaze, eye highlights, finely detailed beautiful eyes}}}},
0.9::artist:kat (bu-kunn)::,0.9::artist: sumiyao (amam)::, 0.8::aritst:tianliang duohe fangdongye::,0.5::artist:pelican (s030)::, 0.5::artist:null (nyanpyoun)::, 0.9::artist:mignon::, 1.2::aritst:ie_(raarami)}::, 1.4::artist:fanteam::, year 2024, year 2025,
[HERE ADD YOUR TAGS]
\`\`\`
## Negative prompt template (no need to modify except special cases. Always include these keywords into negative prompt)
\`\`\`
{{normal quality, bad quality, low quality, worst quality, lowres, displeasing, bad anatomy, bad perspective, bad proportions, bad face, bad arm, bad hands, bad leg, bad feet, bad reflection, bad link, bad source, wrong hand, wrong feet, missing, missing limb, missing eye, missing tooth, missing ear, missing finger, extra, extra faces, extra eyes, extra mouth, extra ears, extra breasts, extra arms, extra hands, extra legs, extra digits, fewer digits, cropped, cropped head, cropped torso, cropped arms, cropped legs, JPEG artifacts, signature, watermark, username, blurry, artist name, fat, duplicate, mutation, deformed, disfigured, long neck, unfinished, chromatic aberration, scan, scan artifacts, abstract, @_@, brown skin, glasses, vertical lines, vertical banding}},
\`\`\`
`;

const SQL_TEMPLATE = `
Database Schema for Query Tool Usage
This document outlines the structure of the database used to store our conversations. The database consists of two primary tables: conversations and messages.

1. Table: conversations
This table stores the metadata for each distinct conversation session.

Columns:

 - id (uuid): The unique identifier for the conversation. This is the primary key and is used to link messages to a conversation.
 - title (text): The human-readable name of the conversation (e.g., '1-main', '2-main', '0-M'). This is typically used to find the corresponding id.
 - created_at (timestamp with time zone): A timestamp indicating when the conversation was first created.
 - updated_at (timestamp with time zone): A timestamp indicating the last time a message was added to the conversation.
 - user_id (text): An identifier for the user associated with the conversation.
2. Table: messages
This table stores every individual message exchanged within all conversations.

Columns:
 - id (uuid): The unique identifier for each specific message.
 - conversation_id (uuid): A foreign key that links the message to a specific session in the conversations table via its id.
 - parts (jsonb): The content of the message itself, stored in a JSONB format.
 - created_at (timestamp with time zone): A timestamp indicating precisely when the message was created.
 - role (text): Indicates the sender of the message. The value is typically either 'user' or 'assistant'.
3. Relationship & Common Usage
To retrieve messages from a specific conversation (e.g., '3-main'), you must first find its unique id in the conversations table and then use that id to filter the messages table on the conversation_id column.

Example Queries:

To find the ID of a conversation:

SELECT id FROM conversations WHERE title = '3-main';
To retrieve the 10 most recent messages from a conversation:
\`\`\`
SELECT role, parts, created_at
FROM messages
WHERE conversation_id = (SELECT id FROM conversations WHERE title = '3-main')
ORDER BY created_at DESC
LIMIT 10;
\`\`\`
To count all messages in a conversation:
\`\`\`
SELECT COUNT(*)
FROM messages
WHERE conversation_id = (SELECT id FROM conversations WHERE title = '3-main');
\`\`\`
`;

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
				description: `Run a SQL query and return the result. ￦n${SQL_TEMPLATE}`,
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
			},
			{
				name: 'imageGeneration',
				description: `Generate an image based on the given prompts. Here\'s the guideline. \n${PROMPT_TEMPLATE}`,
				parameters: {
					type: Type.OBJECT,
					properties: {
						positivePrompt: {
							type: Type.STRING,
							description: 'The positive prompt describing the desired image content.'
						},
						negativePrompt: {
							type: Type.STRING,
							description: 'The negative prompt describing what to avoid in the image.'
						},
						seed: {
							type: Type.NUMBER,
							description:
								'The seed for random number generation to ensure reproducibility. If you change your expression or posture slightly in a row of images, keep the seed the same. In other cases, enter a random natural number that is not too long (about 12 characters)'
						}
					},
					required: ['positivePrompt', 'negativePrompt', 'seed']
				}
			}
		] as FunctionDeclaration[]
	}
];

interface ToolResult {
	sendBack: boolean;
	role: 'user' | 'model' | undefined;
	data: any;
}

export const actualTool: Record<string, (params: any) => Promise<ToolResult | null>> = {
	alert: async (params: { message: string }) => {
		alert(params.message);
		return {
			sendBack: false,
			role: 'user',
			data: makeFunctionResponse('alert', { message: 'Alert displayed' })
		};
	},
	javascript: async (params: { expression: string }) => {
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
			sendBack: true,
			role: 'user',
			data: makeFunctionResponse('javascript', capturedLogs.join('\n'))
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
			sendBack: true,
			role: 'user',
			data: makeFunctionResponse('choice', { choice: choosenOption })
		};
	},
	query: async (params: { query: string }) => {
		let res = await apiFetch(`/api/query?query=${encodeURIComponent(params.query)}`);
		return {
			sendBack: true,
			role: 'user',
			data: makeFunctionResponse('query', res)
		};
	},
	imageGeneration: async (
		params: { positivePrompt: string; negativePrompt: string; seed: number } = {
			positivePrompt: '',
			negativePrompt: '',
			seed: 1
		}
	) => {
		return {
			sendBack: false,
			data: {
				inlineData: {
					mimeType: 'image/png',
					data: await handleNAI(
						params.positivePrompt,
						params.negativePrompt,
						get(nai_api_key),
						params.seed
					)
				}
			},
			role: 'model'
		};
	}
};

const makeFunctionResponse = (functionName: string, result: any) => {
	return {
		functionResponse: {
			name: functionName,
			response: {
				output: result
			}
		}
	};
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

const selectedModel = 'nai-diffusion-4-5-full';
const selectedSize = '832x1216';

// Returning image as a base64 data URL
async function handleNAI(
	positivePrompts: string,
	negativePrompts: string,
	apiKey: string,
	seed: number
) {
	console.log('Making direct API call...');

	const requestBody = getNAIRequestBody(
		positivePrompts,
		negativePrompts,
		selectedModel,
		selectedSize,
		// Math.floor(Math.random() * 10000000)
		seed
	);

	try {
		const response = await fetch('https://image.novelai.net/ai/generate-image', {
			method: 'POST',
			headers: {
				Accept: '*/*',
				// 'Accept-Language': 'ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3',
				'Content-Type': 'binary/octet-stream',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify(requestBody)
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`API Error: ${response.status} - ${errorText}`);
		}

		const readableStream = response.body;

		if (!readableStream) {
			throw new Error('No response body received');
		}

		// Get the image data from the stream
		const reader = readableStream.getReader();
		const chunks = [];
		let done = false;
		while (!done) {
			const { value, done: isDone } = await reader.read();
			if (isDone) {
				done = true;
			} else {
				chunks.push(value);
			}
		}

		console.log(chunks);

		// Combine all chunks into a single array buffer
		const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
		const combinedArray = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			combinedArray.set(chunk, offset);
			offset += chunk.length;
		}

		// Check if it's a ZIP file (magic bytes: 0x50 0x4b)
		if (combinedArray[0] === 0x50 && combinedArray[1] === 0x4b) {
			console.log('🗜️ Detected ZIP file, extracting with JSZip...');

			try {
				const zip = new JSZip();
				const zipContent = await zip.loadAsync(combinedArray);

				// Find the first image file
				const imageFile = Object.keys(zipContent.files).find((filename) =>
					filename.match(/\.(png|jpg|jpeg|gif|webp)$/i)
				);

				if (imageFile) {
					console.log('� Found image file:', imageFile);
					const imageData = await zipContent.files[imageFile].async('blob');

					console.log('✅ Image extracted from ZIP successfully');
					// return URL.createObjectURL(imageData);
					// Return as base64 data URL
					const arrayBuffer = await imageData.arrayBuffer();
					const uint8Array = new Uint8Array(arrayBuffer);
					const base64String = btoa(
						uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), '')
					);
					return base64String;
				} else {
					throw new Error('No image file found in ZIP');
				}
			} catch (zipError: any) {
				console.error('❌ ZIP extraction failed:', zipError);
				throw new Error(`Failed to extract ZIP: ${zipError.message}`);
			}
		} else {
			// Not a ZIP file, handle as regular image
			// const blob = new Blob([combinedArray]);
			// const imageUrl = URL.createObjectURL(blob);
			// generatedImage = imageUrl;
			const base64String = btoa(
				combinedArray.reduce((data, byte) => data + String.fromCharCode(byte), '')
			);
			return base64String;
		}
	} catch (error) {
		console.error('Error:', error);
	}
}

export function getNAIRequestBody(
	positive_prompts: any,
	negative_prompts: any,
	model: any,
	size: any,
	seed: any,
	steps: number = 28,
	guidance_scale: number = 7.5,
	cfg_rescale: number = 1.0
) {
	const [width, height] = size.split('x').map(Number);

	// console.log(`🔧 Preparing NAI request body with size: ${width}x${height}`);

	return {
		action: 'generate',
		input: positive_prompts,
		model: model,
		parameters: {
			add_original_image: true,
			autoSmea: false,
			cfg_rescale: cfg_rescale,
			characterPrompts: [],
			controlnet_strength: 1,
			dynamic_thresholding: false,
			height: height,
			inpaintImg2ImgStrength: 1,
			legacy: false,
			legacy_uc: false,
			legacy_v3_extend: false,
			n_samples: 1,
			negative_prompt: negative_prompts,
			noise_schedule: 'karras',
			normalize_reference_strength_multiple: true,
			params_version: 3,
			qualityToggle: true,
			sampler: 'k_euler',
			scale: guidance_scale,
			seed: seed,
			skip_cfg_above_sigma: null,
			steps: steps,
			stream: 'msgpack',
			ucPreset: 4,
			use_coords: false,
			v4_negative_prompt: {
				caption: {
					base_caption: negative_prompts,
					char_captions: []
				},
				legacy_uc: false
			},
			v4_prompt: {
				caption: {
					base_caption: positive_prompts,
					char_captions: []
				},
				use_coords: false,
				use_order: true
			},
			width: width
		}
	};
}
