<script lang="ts">
	import { onMount } from 'svelte';
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

	let loadingConversations: boolean = false;
	let loadingMessages: boolean = false;
	let isMessageStreaming = false; // Placeholder for streaming state

	let conversationList: Array<Conversation> = [];
	let currentConversationID: string = '';
	let messageList: Array<Message> = [];

	let inputMessage: string = '';

	let GEMINI_API_KEY: string;
	let GEMINI_MODEL: string;
	let GEMINI_TEMPERATURE: number;
	let GEMINI_THINKING: boolean;
	let GEMINI_THINKING_BUDGET: number;
	let GEMINI_SYSTEM_PROMPT: string;

	const initializeFromLocalStorage = () => {
		GEMINI_API_KEY = localStorage.getItem('GEMINI_API_KEY') || '';
		GEMINI_MODEL = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-pro';
		GEMINI_TEMPERATURE = parseFloat(localStorage.getItem('GEMINI_TEMPERATURE') || '0.95');
		GEMINI_THINKING = localStorage.getItem('GEMINI_THINKING') === 'true';
		GEMINI_THINKING_BUDGET = parseInt(localStorage.getItem('GEMINI_THINKING_BUDGET') || '512', 10);
		GEMINI_SYSTEM_PROMPT =
			localStorage.getItem('GEMINI_SYSTEM_PROMPT') || 'You are a helpful assistant.';
	};

	onMount(() => {
		loadConversations();
		focusToInput();
		initializeFromLocalStorage();

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
		fetch('/api/conversation', {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})
			.then((response) => response.json())
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
		fetch(`/api/message?conversation_id=${conversationID}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		})
			.then((response) => response.json())
			.then((data) => {
				console.log('Messages for conversation:', conversationID, data);
				messageList = data.rows; // Assuming the response is an array of messages
			})
			.catch((error) => {
				console.error('Error fetching messages:', error);
			})
			.finally(() => {
				loadingMessages = false; // Reset loading state
				scrollToBottom(); // Scroll to the bottom after loading messages
			});
	};

	const streamingMessage: Message = {
		id: '',
		conversation_id: '',
		role: 'model',
		content: ''
	}; // Placeholder for streaming message

	const handleSend = () => {
		if (isMessageStreaming) {
			console.warn('Message is currently being streamed. Please wait.');
			return; // Prevent sending a new message while streaming
		}

		inputMessage = inputMessage.trim();
		if (inputMessage) {
			// Plan
			// - // Add it into messageList, send it to the llm api, then append it to the DB
			const newMessage: Message = {
				id: crypto.randomUUID(), // Generate a unique ID for the message
				conversation_id: currentConversationID,
				role: 'user',
				content: inputMessage
			};
			messageList = [...messageList, newMessage]; // Add the new message to the message list
			scrollToBottom();

			// POST the new message to the API
			fetch(`/api/message`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(newMessage)
			})
				.then((response) => response.json())
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

		for (const message of messageList) {
			switch (message.role) {
				case 'model':
					context.push({
						role: 'model',
						parts: [{ text: message.content } as Part, ...(message.metadata?.parts || [])]
					});
					break;
				case 'user':
					context.push({
						role: 'user',
						parts: [
							message.content && !(message.content === '')
								? ({ text: message.content } as Part)
								: {},
							...(message.metadata?.parts || [])
						]
					});
					break;
				default:
					console.warn(`Unknown message role: ${message.role}`);
			}
		}

		isMessageStreaming = true; // Set streaming state to true
		streamingMessage.content = ''; // Clear the streaming message content
		streamingMessage.conversation_id = currentConversationID; // Set the conversation ID for the streaming message
		streamingMessage.role = 'model'; // Set the role for the streaming message
		streamingMessage.id = crypto.randomUUID(); // Generate a unique ID for the streaming message

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

		const chunks = [];
		const metadata = {
			parts: [] as Part[]
		};

		for await (const chunk of response) {
			if (!chunk) {
				console.warn('Received empty chunk');
				continue;
			}
			chunks.push(chunk); // Collect chunks for further processing
			console.log('Received chunk:', chunk);

			// scroll to streaming message
			scrollToBottom();

			if (chunk.candidates && chunk.candidates.length > 0) {
				// If the chunk contains candidates, process the first candidate
				const candidate = chunk.candidates[0];
				if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
					// Append the text part of the content to the streaming message
					// streamingMessage.content += candidate.content.parts[0].text;
					for (const part of candidate.content.parts) {
						// If part.text is not empty, append it to the streaming message
						if (part.text && part.text.trim() !== '') {
							streamingMessage.content += part.text; // Append each part's text
						}

						// If other parts exists, add it to the metadata.parts
						if (part.functionCall) {
							metadata.parts.push({
								functionCall: part.functionCall
							});
						}
					}
				}
			}
		}

		streamingMessage.metadata = metadata as any; // Assign the metadata to the streaming message

		// Streaming complete
		isMessageStreaming = false;
		messageList = [...messageList, { ...streamingMessage }];

		const postOriginalPromise = fetch(`/api/message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ ...streamingMessage })
		});

		// If functionCall is present, handle it

		// if (metadata.parts.length > 0) {
		for (const part of metadata?.parts) {
			if (!part.functionCall?.name) {
				continue;
			}

			console.log('Function call detected:', part.functionCall);
			// Handle the function call here, e.g., execute the function or log it

			const functionName = part.functionCall.name as keyof typeof actualTool;
			if (!actualTool[functionName]) {
				console.error(`Function ${functionName} is not defined in actualTool`);
				continue; // Skip if the function is not defined
			}

			//@ts-ignore
			const toolResult = await actualTool[functionName](part.functionCall.args);
			console.log('Function call result:', toolResult);
			// You can handle the result here, e.g., send it back to the LLM or log it

			// Append the result to the streaming message content
			const resultMessage: Message = {
				id: crypto.randomUUID(),
				conversation_id: currentConversationID,
				role: 'user',
				content: '',
				metadata: {
					parts: [
						{
							functionResponse: {
								name: functionName,
								response: {
									output: toolResult
								}
							}
						}
					]
				}
			};

			messageList = [...messageList, { ...resultMessage }];

			// POST the result message to the API
			await postOriginalPromise; // Ensure the original message is posted first

			fetch(`/api/message`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(resultMessage)
			});

			handleAPI(); // Call the API handler to process the result message
		}
	};
</script>

<title>ONLY DAIKENSA V2</title>
<div id="app">
	<!-- Main application container -->
	<div id="header">
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

		<button onclick={() => loadConversations()} ontouchstart={() => loadConversations()}
			>Reload Conversations</button
		>
		<button
			onclick={() => updateMessageList(currentConversationID)}
			ontouchstart={() => updateMessageList(currentConversationID)}>Reload Messages</button
		>

		<!-- Vertical line -->
		<span class="vertical-line"></span>

		<details style="">
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
	</div>

	<div id="message-container">
		{#if loadingMessages}
			<h1 style="margin: auto;">Loading messages...</h1>
		{:else}
			{#each messageList as message}
				<MessageElement
					{message}
					deleteMessage={async () => {
						messageList = messageList.filter((m) => m.id !== message.id); // Remove the message from the list

						await fetch(`/api/message/`, {
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
				<MessageElement message={streamingMessage} deleteMessage={() => {}} />
			</div>
		{/if}
	</div>

	<div id="input-container">
		<button>+</button>
		<textarea placeholder="메시지 입력" bind:value={inputMessage}></textarea>
		<button
			id="send-button"
			onclick={() => handleSend()}
			ontouchstart={() => {
				handleSend();
				alert('Message sent!');
			}}
			aria-label="Send message"
		>
			<span
				style="content: url('https://api.iconify.design/line-md/arrow-right-square.svg'); width: 24px; height: 24px; display: inline-block;"
				>→</span
			>
		</button>
	</div>
</div>

<style>
	.vertical-line {
		border-left: 1px solid #ccc;
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
		border: 1px solid #ccc;
		border-radius: 8px;

		background-color: #f9f9f9;

		display: flex;
		flex-direction: column;
	}

	#header {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;

		gap: 10px;
		align-items: center;
		justify-content: left;
		width: 100%;
		height: auto;

		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 10px;
		background-color: #e9ecef;
	}

	#header button {
		min-height: 44px; /* Minimum touch target size for mobile */
		padding: 8px 12px;
		border: 1px solid #ccc;
		border-radius: 4px;
		background-color: #fff;
		cursor: pointer;
		transition: background-color 0.2s;
		font-size: 14px;
	}

	#header button:hover {
		background-color: #f8f9fa;
	}

	#header button:active {
		background-color: #e9ecef;
	}

	#header select {
		min-height: 44px; /* Minimum touch target size for mobile */
		padding: 8px;
		border: 1px solid #ccc;
		border-radius: 4px;
		background-color: #fff;
		font-size: 14px;
	}

	#llm-settings {
		width: 90%;
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		gap: 10px;

		padding: 10px;
	}

	#message-container {
		flex-grow: 1;
		overflow-y: scroll;
		margin-top: 20px;

		padding: 10px;
		border: 1px solid #ccc;
		border-radius: 4px;

		background-color: #fff;

		display: flex;
		flex-direction: column;
		gap: 10px;

		font-size: 14px;
		line-height: 1.5;
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
			border: 1px solid #ccc;
			border-radius: 4px;
			font-size: 16px; /* Prevents zoom on iOS */
			resize: none;
		}

		& > button {
			min-height: 44px; /* Minimum touch target size for mobile */
			min-width: 44px;
			padding: 8px;
			border: 1px solid #ccc;
			border-radius: 4px;
			background-color: #fff;
			cursor: pointer;
			transition: background-color 0.2s;
		}

		& > button:hover {
			background-color: #f8f9fa;
		}

		& > button:active {
			background-color: #e9ecef;
		}
	}

	#send-button {
		background: none;
		border: none;
		cursor: pointer;
		padding: 5px;
		border-radius: 4px;
		transition: background-color 0.2s;
	}

	#send-button:hover {
		background-color: #e9ecef;
	}

	#send-button:active {
		background-color: #dee2e6;
	}

	/* ------- */
</style>
