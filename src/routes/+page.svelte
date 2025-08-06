<script lang="ts">
	import { onMount } from 'svelte';
	import type { Conversation, Message } from '$lib/types';

	import { GoogleGenAI, HarmBlockMethod, HarmBlockThreshold, HarmCategory } from '@google/genai';
	import type { Part, Content } from '@google/genai';

	let loadingConversations: boolean = false;
	let loadingMessages: boolean = false;

	let conversationList: Array<Conversation> = [];
	let currentConversationID: string = '';
	let messageList: Array<Message> = [];

	let inputMessage: string = '';

	let GEMINI_API_KEY: string = '';
	let GEMINI_MODEL: string = 'gemini-2.5-pro';
	let GEMINI_TEMPERATURE: number = 0.95;
	let GEMINI_THINKING: boolean = true;
	let GEMINI_THINKING_BUDGET: number = 1024;

	onMount(() => {
		loadConversations();
		focusToInput();

		// Enter key handling for input
		const inputElement: HTMLInputElement | null = document.querySelector('#input-container input');
		if (inputElement) {
			inputElement.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault(); // Prevent default form submission
					handleSend(); // Call the send function
				}
			});
		}
	});

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
		const inputElement: HTMLInputElement | null = document.querySelector('#input-container input');
		if (inputElement) {
			inputElement.focus();
		}
	};

	const updateMessageList = (conversationID: string = currentConversationID) => {
		loadingMessages = true; // Set loading state for messages

		// Fetching messages for a specific conversation
		fetch(`/api/message/${conversationID}`, {
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
			});
	};

	let isMessageStreaming = false; // Placeholder for streaming state
	const streamingMessage: Message = {
		id: '',
		conversation_id: '',
		role: 'model',
		content: ''
	}; // Placeholder for streaming message

	const handleSend = () => {
		inputMessage = inputMessage.trim();
		if (!inputMessage) {
			// If the input is empty, do nothing
			return;
		}

		// Plan
		// - // Add it into messageList, send it to the llm api, then append it to the DB
		const newMessage: Message = {
			id: crypto.randomUUID(), // Generate a unique ID for the message
			conversation_id: currentConversationID,
			role: 'user',
			content: inputMessage
		};
		messageList = [...messageList, newMessage]; // Add the new message to the message list

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

		// Send the message to the LLM API
		const ai = new GoogleGenAI({
			apiKey: GEMINI_API_KEY
		});

		// -- // Create entire context for the LLM API from the messageList
		const context: Content[] = messageList.map((msg) => ({
			role: msg.role === 'model' ? 'model' : 'user',
			parts: [{ text: msg.content } as Part]
		}));

		isMessageStreaming = true; // Set streaming state to true
		streamingMessage.content = ''; // Clear the streaming message content
		streamingMessage.conversation_id = currentConversationID; // Set the conversation ID for the streaming message
		streamingMessage.role = 'model'; // Set the role for the streaming message
		streamingMessage.id = crypto.randomUUID(); // Generate a unique ID for the streaming message

		ai.models
			.generateContentStream({
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
					thinkingConfig: {
						includeThoughts: true,
						thinkingBudget: GEMINI_THINKING ? GEMINI_THINKING_BUDGET : 0
					}
				},
				contents: context
			})
			.then(async (response) => {
				for await (const chunk of response) {
					if (chunk.text) {
						console.log('Received chunk:', chunk.text);
						streamingMessage.content += chunk.text; // Append the chunk text to the streaming message
					}
				}

				isMessageStreaming = false; // Set streaming state to false after the response is complete
				// Append the streaming message to the message list
				messageList = [...messageList, { ...streamingMessage }];

				return { ...streamingMessage };
			})
			.then((finalMessage) => {
				// POST the final message to the API
				fetch(`/api/message`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(finalMessage)
				})
					.then((response) => response.json())
					.then((data) => {
						console.log('Final message sent:', data);
						// Optionally, you can handle the response here

						console.log('Message list updated:', messageList);
					})
					.catch((error) => {
						console.error('Error sending final message:', error);
					});
			})
			.catch((error) => {
				console.error('Error generating content stream:', error);
				isMessageStreaming = false; // Reset streaming state on error
			});
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

		<button onclick={() => loadConversations()}>Reload Conversations</button>
		<button onclick={() => updateMessageList(currentConversationID)}>Reload Messages</button>

		<!-- Vertical line -->
		<span class="vertical-line"></span>

		<details style="">
			<summary>LLM</summary>
			<div id="llm-settings">
				<select bind:value={GEMINI_MODEL}>
					{#each ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as model}
						<option value={model}>{model}</option>
					{/each}
				</select>
				<span class="vertical-line"></span>
				<label for="thinking-checkbox">Thinking</label>
				<input type="checkbox" id="thinking-checkbox" bind:checked={GEMINI_THINKING} />
				<input
					type="number"
					placeholder="Thinking Budget"
					bind:value={GEMINI_THINKING_BUDGET}
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
					min="0"
					max="1"
					step="0.01"
				/>
				<br />
				<input type="password" placeholder="API_KEY" bind:value={GEMINI_API_KEY} />
			</div>
		</details>
	</div>

	<div id="message-container">
		{#if loadingMessages}
			<h1 style="margin: auto;">Loading messages...</h1>
		{:else}
			{#each messageList as message}
				<div class="{message.role} message">{message.content}</div>
			{/each}
		{/if}
		{#if isMessageStreaming}
			<div class="model message">
				{#if streamingMessage.content}
					{streamingMessage.content}
				{:else}
					<span>Streaming...</span>
				{/if}
			</div>
		{/if}
	</div>

	<div id="input-container">
		<button>+</button>
		<input type="text" placeholder="메시지 입력" bind:value={inputMessage} />
		<button onclick={() => handleSend()}>&#x27A4;</button>
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

		& > input {
			flex-grow: 1;
			margin: 10px;
			padding: 3px;
			border: 1px solid #ccc;
			border-radius: 4px;
		}
	}

	/* ------- */
	.message {
		padding: 10px;
		border-radius: 4px;

		background-color: #f0f0f0;
		border: 1px solid #ccc;

		margin-left: 10px;
		margin-right: 10px;

		width: fit-content;
		max-width: 80%;
		word-break: break-word;
		text-wrap-mode: wrap;
	}

	.user,
	.system {
		/* Stick it to the right side */
		margin-left: auto;
	}
</style>
