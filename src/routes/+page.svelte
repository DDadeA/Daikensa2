<script lang="ts">
	import { onMount } from 'svelte';
	import type { Conversation, Message } from '$lib/types';

	let loadingConversations: boolean = false;
	let loadingMessages: boolean = false;

	let conversationList: Array<Conversation> = [];
	let currentConversationID: string = '';
	let messageList: Array<Message> = [];

	let inputMessage: string = '';

	let GEMINI_API_KEY: string = '';
	let GEMINI_MODEL: string = 'gemini-2.5-pro';

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
		inputMessage = ''; // Clear the input field
		focusToInput(); // Refocus the input field
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

		<details>
			<summary>LLM</summary>
			<input type="password" placeholder="API_KEY" bind:value={GEMINI_API_KEY} />
			<select bind:value={GEMINI_MODEL}>
				{#each ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as model}
					<option value={model}>{model}</option>
				{/each}
				<!-- Add more options as needed -->
			</select>
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
		padding: 3px;
		background-color: #e9ecef;
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
