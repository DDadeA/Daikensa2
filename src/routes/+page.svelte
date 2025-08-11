<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Conversation, Message } from '$lib/types';
	import MessageElement from '$lib/components/MessageElement.svelte';

	import { GoogleGenAI } from '@google/genai';
	import {
		HarmBlockMethod,
		HarmCategory,
		HarmBlockThreshold,
		FunctionCallingConfigMode
	} from '@google/genai';

	import type { Part, Content } from '@google/genai';

	import { toolConfig, tools, actualTool } from '$lib/tools';
	import { streamingText } from '$lib/stores';

	import { apiFetch } from '$lib/api';

	let loadingConversations: boolean = false;
	let loadingMessages: boolean = false;
	let isMessageStreaming = false; // Placeholder for streaming state

	let conversationList: Array<Conversation> = [];
	let currentConversationID: string = '';
	let messageList: Array<Message> = [];

	let inputMessage: string = '';
	// let streamingText: string = ''; // Placeholder for streaming text

	let GEMINI_API_KEY: string;
	let GEMINI_MODEL: string;
	let GEMINI_TEMPERATURE: number;
	let GEMINI_THINKING: boolean;
	let GEMINI_THINKING_BUDGET: number;
	let GEMINI_SYSTEM_PROMPT: string;

	let currentTheme: 'light' | 'dark' = 'light';

	const initializeFromLocalStorage = () => {
		GEMINI_API_KEY = localStorage.getItem('GEMINI_API_KEY') || '';
		GEMINI_MODEL = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-pro';
		GEMINI_TEMPERATURE = parseFloat(localStorage.getItem('GEMINI_TEMPERATURE') || '0.95');
		GEMINI_THINKING = localStorage.getItem('GEMINI_THINKING') === 'true';
		GEMINI_THINKING_BUDGET = parseInt(localStorage.getItem('GEMINI_THINKING_BUDGET') || '512', 10);
		GEMINI_SYSTEM_PROMPT =
			localStorage.getItem('GEMINI_SYSTEM_PROMPT') || 'You are a helpful assistant.';
		currentTheme = (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
		applyTheme(currentTheme);
	};

	const applyTheme = (theme: 'light' | 'dark') => {
		document.documentElement.setAttribute('data-theme', theme);
	};

	const toggleTheme = () => {
		currentTheme = currentTheme === 'light' ? 'dark' : 'light';
		localStorage.setItem('theme', currentTheme);
		applyTheme(currentTheme);
	};

	const randomUUID = () => {
		// crypto.randomUUID() not works
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	};

	onMount(() => {
		loadConversations();
		focusToInput();
		initializeFromLocalStorage();
		initializeAuthToken();

		// Enter key handling for input
		const inputElement: HTMLTextAreaElement | null = document.querySelector(
			'#input-container textarea'
		);
		if (inputElement) {
			inputElement.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault(); // Prevent default form submission

					// Check whether Shift is pressed
					if (event.shiftKey) {
						// Allow new line insertion
						inputElement.value += '\n';
					} else {
						// Send the message
						handleSend();
					}
				}
			});
		}
	});

	const initializeAuthToken = () => {
		// Get authToken from params
		const urlParams = new URLSearchParams(window.location.search);
		const authToken = urlParams.get('authToken');

		// If exists, save it into localstorage
		if (authToken) {
			localStorage.setItem('authToken', authToken);
			alert(`authToken saved: ${authToken}`);
		}
	};

	const scrollToBottom = () => {
		setTimeout(() => {
			const streamingMessageElement: HTMLElement | null =
				document.querySelector('#streaming-message');
			if (streamingMessageElement) {
				streamingMessageElement.scrollIntoView({ behavior: 'smooth' });
			} else {
				// console.warn('Streaming message element not found for scrolling');

				// Scroll to the last message in the message container
				const finalMessageID = messageList.length > 0 ? messageList[messageList.length - 1].id : '';
				const lastMessageElement: HTMLElement | null = finalMessageID
					? document.getElementById(finalMessageID)
					: null;

				if (lastMessageElement) {
					lastMessageElement.scrollIntoView({ behavior: 'smooth' });
				} else {
					console.warn('Last message element not found for scrolling', finalMessageID);
				}
			}
		}, 300);
	};

	const loadConversations = () => {
		loadingConversations = true; // Set loading state

		// Fetching conversations from the API
		apiFetch('/api/conversation', {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})
			// .then((response) => response.json())
			.then((data) => {
				console.log('Conversations:', data);

				// Get first conversation ID if available
				if (data.length > 0) {
					conversationList = data; // Assuming the response is an array of conversations
					currentConversationID = data[0].id; // Set the first conversation as the current one
					updateMessageList(currentConversationID); // Fetch messages for the first conversation
				} else {
					console.warn('No conversations found');
				}
			})
			.catch((error) => {
				console.error('Error fetching conversations:', error);
			})
			.finally(() => {
				loadingConversations = false; // Reset loading state
			});
	};

	const focusToInput = () => {
		// Focus the input field when the component mounts
		const inputElement: HTMLTextAreaElement | null = document.querySelector(
			'#input-container textarea'
		);
		if (inputElement) {
			inputElement.focus();
		}
	};

	const updateMessageList = (conversationID: string = currentConversationID) => {
		loadingMessages = true; // Set loading state for messages

		// Fetching messages for a specific conversation
		apiFetch(`/api/message?conversation_id=${conversationID}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})
			// .then((response) => response.json())
			.then((data) => {
				messageList = data.rows.sort(
					(a: Message, b: Message) =>
						new Date(a.created_at?.slice(0, 23) || '').getTime() -
						new Date(b.created_at?.slice(0, 23) || '').getTime()
				);
				console.log('Messages for conversation:', conversationID, messageList);
			})
			.catch((error) => {
				console.error('Error fetching messages:', error);
			})
			.finally(() => {
				loadingMessages = false; // Reset loading state
				scrollToBottom(); // Scroll to the bottom after loading messages
			});
	};

	let streamingMessage: Message = {
		id: '',
		conversation_id: '',
		role: 'model',
		parts: []
	}; // Placeholder for streaming message

	let AUTO_TIMESTAMP: boolean = true; // Auto timestamp toggle
	const handleSend = () => {
		if (isMessageStreaming) {
			console.warn('Message is currently being streamed. Please wait.');
			return; // Prevent sending a new message while streaming
		}

		inputMessage = inputMessage.trim();

		if (AUTO_TIMESTAMP) {
			// KST
			const timestamp = new Date()
				.toLocaleString('ko-KR', {
					timeZone: 'Asia/Seoul'
				})
				.replaceAll('. ', '.')
				.replace('오전', 'AM')
				.replace('오후', 'PM'); // Get current timestamp in KST
			inputMessage = `${timestamp}\n${inputMessage}`; // Prepend timestamp to the message
		}

		if (inputMessage) {
			// Plan
			// - // Add it into messageList, send it to the llm api, then append it to the DB
			// alert(randomUUID());
			const newMessage: Message = {
				id: randomUUID(), // Generate a unique ID for the message
				conversation_id: currentConversationID,
				role: 'user',
				parts: [{ text: inputMessage }]
			};
			messageList = [...messageList, newMessage]; // Add the new message to the message list
			scrollToBottom();

			// POST the new message to the API
			apiFetch(`/api/message`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(newMessage)
			})
				// .then((response) => response.json())
				.then((data) => {
					console.log('Message sent:', data);
					// Optionally, you can handle the response here
				})
				.catch((error) => {
					console.error('Error sending message:', error);
				});

			inputMessage = ''; // Clear the input field
			focusToInput(); // Refocus the input field
		}

		handleAPI(); // Call the function to handle API interaction
	};

	const handleAPI = async () => {
		// Send the message to the LLM API
		const ai = new GoogleGenAI({
			apiKey: GEMINI_API_KEY
		});

		// -- // Create entire context for the LLM API from the messageList
		let context: Content[] = [];

		// Create context from messageList
		for (const message of messageList) {
			context.push({
				role: message.role,
				parts: message.parts
			});
		}

		console.log('target context', context);

		isMessageStreaming = true; // Set streaming state to true
		streamingMessage.conversation_id = currentConversationID; // Set the conversation ID for the streaming message
		streamingMessage.role = 'model'; // Set the role for the streaming message
		streamingMessage.id = randomUUID(); // Generate a unique ID for the streaming message
		streamingMessage.parts = []; // Initialize parts for the streaming message
		$streamingText = ''; // Reset streaming text

		const response = await ai.models.generateContentStream({
			model: GEMINI_MODEL,
			config: {
				temperature: GEMINI_TEMPERATURE,
				safetySettings: [
					HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
					HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
					HarmCategory.HARM_CATEGORY_HARASSMENT,
					HarmCategory.HARM_CATEGORY_HATE_SPEECH,
					HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT
				].map((category) => ({
					category,
					threshold: HarmBlockThreshold.OFF
				})),
				systemInstruction: GEMINI_SYSTEM_PROMPT,
				thinkingConfig: {
					includeThoughts: false,
					thinkingBudget: GEMINI_THINKING ? GEMINI_THINKING_BUDGET : 0
				},
				toolConfig: toolConfig,
				tools: tools
			},
			contents: context
		});
		for await (const chunk of response) {
			if (!chunk) {
				console.warn('Received empty chunk');
				continue;
			}

			if (!(chunk.candidates && chunk.candidates.length > 0)) {
				console.warn('No candidates found in the chunk');
				continue; // Skip if no candidates are found
			}

			// If the chunk contains candidates, process the first candidate
			const candidate = chunk.candidates[0];

			if (!(candidate.content && candidate.content.parts && candidate.content.parts.length > 0)) {
				console.warn('No content parts found in the candidate');
				continue;
			}

			for (let part of candidate.content.parts) {
				// Remove thoughtSignature
				if (part.thoughtSignature) {
					delete part.thoughtSignature; // Remove thoughtSignature from the part
				}
				// If part.text is not empty, append it to the streaming message
				streamingMessage.parts.push(part); // Append each part to the streaming message

				if (part.text) {
					$streamingText += part.text; // Append text to streamingText if it exists
					// Force Svelte to trigger reactivity and update DOM
					// await tick();
				}
			}

			// scroll to streaming message
			scrollToBottom();
		}
		// Streaming complete
		isMessageStreaming = false;

		// Remove thoughtSignature

		// Merging text parts in streamingMessage parts
		// -- // Filter if any text part
		const textParts = streamingMessage.parts.filter((part) => part.text);

		if (textParts.length > 0) {
			const MergedText = textParts.map((part) => part.text).join('');

			// Find the first text part and update its text
			const firstTextPart = streamingMessage.parts.find((part) => part.text);
			if (firstTextPart) {
				firstTextPart.text = MergedText; // Update the text of the first text part
			} else {
				console.warn('No text part found to update with merged text');
			}

			// Remove all other text parts
			streamingMessage.parts = streamingMessage.parts.filter(
				(part) => !part.text || part === firstTextPart
			);
		}
		messageList = [...messageList, { ...streamingMessage }];

		const postOriginalPromise = apiFetch(`/api/message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ ...streamingMessage })
		});

		// If functionCall is present, handle it

		// if (parts.parts.length > 0) {
		// for (const part of parts?.parts) {
		// 	if (!part.functionCall?.name) {
		// 		continue;
		// 	}

		// 	console.log('Function call detected:', part.functionCall);
		// 	// Handle the function call here, e.g., execute the function or log it

		// 	const functionName = part.functionCall.name as keyof typeof actualTool;
		// 	if (!actualTool[functionName]) {
		// 		console.error(`Function ${functionName} is not defined in actualTool`);
		// 		continue; // Skip if the function is not defined
		// 	}

		// 	//@ts-ignore
		// 	const toolResult = await actualTool[functionName](part.functionCall.args);
		// 	console.log('Function call result:', toolResult);
		// 	// You can handle the result here, e.g., send it back to the LLM or log it

		// 	// Append the result to the streaming message content
		// 	const resultMessage: Message = {
		// 		id: randomUUID(),
		// 		conversation_id: currentConversationID,
		// 		role: 'user',
		// 		content: '',
		// 		metadata: {
		// 			parts: [
		// 				{
		// 					functionResponse: {
		// 						name: functionName,
		// 						response: {
		// 							output: toolResult
		// 						}
		// 					}
		// 				}
		// 			]
		// 		}
		// 	};

		// 	messageList = [...messageList, { ...resultMessage }];

		// 	// POST the result message to the API
		// 	await postOriginalPromise; // Ensure the original message is posted first

		// 	apiFetch(`/api/message`, {
		// 		method: 'POST',
		// 		headers: {
		// 			'Content-Type': 'application/json'
		// 		},
		// 		body: JSON.stringify(resultMessage)
		// 	});

		// 	handleAPI(); // Call the API handler to process the result message
		// }
	};
</script>

<title>ONLY DAIKENSA V2</title>
<div id="app">
	<!-- Main application container -->
	<details id="header">
		<summary>{conversationList.find((convo) => convo.id === currentConversationID)?.title}</summary>
		<p>{loadingConversations ? 'Loading conversations...' : 'Chat:'}</p>
		<select
			bind:value={currentConversationID}
			onchange={() => updateMessageList(currentConversationID)}
		>
			{#each conversationList as conversation}
				<option value={conversation.id}>{conversation.title}</option>
			{/each}
		</select>
		<span class="vertical-line"></span>

		<button onclick={() => loadConversations()}>Reload Conversations</button>
		<button onclick={() => updateMessageList(currentConversationID)}>Reload Messages</button>

		<span class="vertical-line"></span>
		<details>
			<summary>Options</summary>
			<div style="display: flex; flex-direction: row; align-items: center;">
				<button onclick={() => toggleTheme()}>
					{currentTheme === 'light' ? '🌙' : '☀️'}
				</button>

				<span class="vertical-line"></span>
				<label for="auto-timestamp">Auto Timestamp</label>
				<input id="auto-timestamp" type="checkbox" bind:checked={AUTO_TIMESTAMP} />
			</div>
		</details>

		<span class="vertical-line"></span>
		<details>
			<summary>LLM</summary>
			<div id="llm-settings">
				<select
					bind:value={GEMINI_MODEL}
					onchange={() => localStorage.setItem('GEMINI_MODEL', GEMINI_MODEL)}
				>
					{#each ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as model}
						<option value={model}>{model}</option>
					{/each}
				</select>
				<span class="vertical-line"></span>
				<label for="thinking-checkbox">Thinking</label>
				<input
					type="checkbox"
					id="thinking-checkbox"
					bind:checked={GEMINI_THINKING}
					oninput={() => localStorage.setItem('GEMINI_THINKING', GEMINI_THINKING?.toString())}
				/>
				<input
					type="number"
					placeholder="Thinking Budget"
					bind:value={GEMINI_THINKING_BUDGET}
					oninput={() =>
						localStorage.setItem('GEMINI_THINKING_BUDGET', GEMINI_THINKING_BUDGET.toString())}
					min="128"
					max="32768"
					step="1"
				/>

				<span class="vertical-line"></span>
				<span>Temp: {GEMINI_TEMPERATURE}</span>
				<input
					type="range"
					placeholder="Temperature"
					bind:value={GEMINI_TEMPERATURE}
					oninput={() => localStorage.setItem('GEMINI_TEMPERATURE', GEMINI_TEMPERATURE.toString())}
					min="0"
					max="1"
					step="0.01"
				/>
				<br />
				<input
					type="password"
					placeholder="API_KEY"
					bind:value={GEMINI_API_KEY}
					oninput={() => localStorage.setItem('GEMINI_API_KEY', GEMINI_API_KEY)}
				/>
				<textarea
					placeholder="system prompt"
					bind:value={GEMINI_SYSTEM_PROMPT}
					oninput={() => localStorage.setItem('GEMINI_SYSTEM_PROMPT', GEMINI_SYSTEM_PROMPT)}
				></textarea>
				<br />
			</div>
		</details>
	</details>

	<div id="message-container">
		{#if loadingMessages}
			<h1 style="margin: auto;">Loading messages...</h1>
		{:else}
			{#each messageList as message}
				<MessageElement
					{message}
					deleteMessage={async () => {
						messageList = messageList.filter((m) => m.id !== message.id); // Remove the message from the list

						await apiFetch(`/api/message/`, {
							method: 'DELETE',
							headers: {
								'Content-Type': 'application/json'
							},

							body: JSON.stringify({
								id: message.id
							})
						});
					}}
				/>
			{/each}
		{/if}
		{#if isMessageStreaming}
			<div class="model message">
				<MessageElement message={streamingMessage} isStreaming={true} />
			</div>
		{/if}
	</div>

	<div id="input-container">
		<button>+</button>
		<textarea placeholder="메시지 입력" bind:value={inputMessage}></textarea>
		<button id="send-button" onclick={() => handleSend()} aria-label="Send message">
			<span
				style="content: url('https://api.iconify.design/line-md/arrow-right-square.svg'); width: 24px; height: 24px; display: inline-block; filter: {currentTheme ===
				'dark'
					? 'invert(1)'
					: 'invert(0)'};">→</span
			>
		</button>
	</div>
</div>

<style>
	:global(:root) {
		/* Light theme colors */
		--bg-primary: #f9f9f9;
		--bg-secondary: #fff;
		--bg-tertiary: #e9ecef;
		--bg-hover: #f8f9fa;
		--bg-active: #e9ecef;

		--text-primary: #212529;
		--text-secondary: #495057;
		--text-muted: #6c757d;

		--border-primary: #ccc;
		--border-secondary: #dee2e6;

		--shadow-light: rgba(0, 0, 0, 0.1);
		--shadow-medium: rgba(0, 0, 0, 0.15);
	}

	:global([data-theme='dark']) {
		/* Dark theme colors */
		--bg-primary: #1a1a1a;
		--bg-secondary: #2d2d2d;
		--bg-tertiary: #404040;
		--bg-hover: #3a3a3a;
		--bg-active: #4a4a4a;

		--text-primary: #ffffff;
		--text-secondary: #e0e0e0;
		--text-muted: #a0a0a0;

		--border-primary: #555;
		--border-secondary: #666;

		--shadow-light: rgba(255, 255, 255, 0.1);
		--shadow-medium: rgba(255, 255, 255, 0.15);
	}

	:global(body) {
		background-color: var(--bg-primary);
		color: var(--text-primary);
		transition:
			background-color 0.3s ease,
			color 0.3s ease;
	}

	.vertical-line {
		border-left: 1px solid var(--border-primary);
		height: 20px;
		margin: 0 10px;
	}

	#app {
		font-family: Arial, sans-serif;
		max-width: 800px;
		height: calc(100dvh - 42px);

		overflow: auto;

		margin: 0 auto;
		padding: 20px;
		border: 1px solid var(--border-primary);
		border-radius: 8px;

		background-color: var(--bg-primary);
		color: var(--text-primary);

		display: flex;
		flex-direction: column;

		transition:
			background-color 0.3s ease,
			color 0.3s ease,
			border-color 0.3s ease;
	}

	#header {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;

		gap: 10px;
		align-items: center;
		justify-content: left;
		width: calc(100% - 20px);
		height: auto;

		border: 1px solid var(--border-primary);
		border-radius: 4px;
		padding: 10px;
		background-color: var(--bg-tertiary);
		color: var(--text-primary);

		transition:
			background-color 0.3s ease,
			border-color 0.3s ease;
	}

	#header button {
		min-height: 44px; /* Minimum touch target size for mobile */
		padding: 8px 12px;
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		background-color: var(--bg-secondary);
		color: var(--text-primary);
		cursor: pointer;
		transition:
			background-color 0.3s ease,
			color 0.3s ease,
			border-color 0.3s ease;
		font-size: 14px;
	}

	#header button:hover {
		background-color: var(--bg-hover);
	}

	#header button:active {
		background-color: var(--bg-active);
	}

	#header select {
		min-height: 44px; /* Minimum touch target size for mobile */
		padding: 8px;
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		background-color: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 14px;
		transition:
			background-color 0.3s ease,
			color 0.3s ease,
			border-color 0.3s ease;
	}

	#llm-settings {
		width: 90%;
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		gap: 10px;

		padding: 10px;
	}

	#llm-settings input,
	#llm-settings textarea,
	#llm-settings select {
		background-color: var(--bg-secondary);
		color: var(--text-primary);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		transition:
			background-color 0.3s ease,
			color 0.3s ease,
			border-color 0.3s ease;
	}

	#llm-settings input:focus,
	#llm-settings textarea:focus,
	#llm-settings select:focus {
		outline: 2px solid var(--border-secondary);
		outline-offset: 2px;
	}

	#message-container {
		flex-grow: 1;
		overflow-y: scroll;
		margin-top: 20px;

		padding: 10px;
		border: 1px solid var(--border-primary);
		border-radius: 4px;

		background-color: var(--bg-secondary);
		color: var(--text-primary);

		display: flex;
		flex-direction: column;
		gap: 10px;

		font-size: 14px;
		line-height: 1.5;

		transition:
			background-color 0.3s ease,
			color 0.3s ease,
			border-color 0.3s ease;
	}

	#input-container {
		display: flex;
		align-items: center;
		margin-top: 20px;

		width: 100%;
		height: 42px;
		justify-content: space-between;

		justify-self: end;

		& > textarea {
			flex-grow: 1;
			margin: 10px;
			padding: 8px;
			border: 1px solid var(--border-primary);
			border-radius: 4px;
			font-size: 16px; /* Prevents zoom on iOS */
			resize: none;
			background-color: var(--bg-secondary);
			color: var(--text-primary);
			transition:
				background-color 0.3s ease,
				color 0.3s ease,
				border-color 0.3s ease;
		}

		& > textarea:focus {
			outline: 2px solid var(--border-secondary);
			outline-offset: 2px;
		}

		& > button {
			min-height: 44px; /* Minimum touch target size for mobile */
			min-width: 44px;
			padding: 8px;
			border: 1px solid var(--border-primary);
			border-radius: 4px;
			background-color: var(--bg-secondary);
			color: var(--text-primary);
			cursor: pointer;
			transition:
				background-color 0.3s ease,
				color 0.3s ease,
				border-color 0.3s ease;
		}

		& > button:hover {
			background-color: var(--bg-hover);
		}

		& > button:active {
			background-color: var(--bg-active);
		}
	}

	#send-button {
		background: none;
		border: none;
		cursor: pointer;
		padding: 5px;
		border-radius: 4px;
		transition: background-color 0.3s ease;
		color: var(--text-primary);
	}

	#send-button:hover {
		background-color: var(--bg-tertiary);
	}

	#send-button:active {
		background-color: var(--bg-active);
	}

	/* ------- */
</style>
