<script lang="ts">
	import { onMount } from 'svelte';

	interface Conversation {
		id: string;
		title: string;
		created_at: string;
		updated_at: string;
	}

	interface Message {
		id: string;
		role: 'user' | 'assistant' | 'system'; // Assuming roles are either 'user' or 'assistant'
		content: string;
		metadatta: JSON;
		created_at: string;
		updated_at: string;
		conversation_id: string; // Assuming messages are linked to conversations
	}

	let conversationList: Array<Conversation> = []; // This can be used to store the list of conversations if needed
	let currentConversationID: string = ''; // Default value, can be updated dynamically

	let messageList: Array<Message> = [];

	onMount(() => {
		main();
	});

	function main() {
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
			});
	}

	const updateMessageList = (conversationID: string) => {
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
			});
	};
</script>

<title>ONLY DAIKENSA V2</title>
<div id="app">
	<!-- Main application container -->
	<div id="header">
		<select
			bind:value={currentConversationID}
			on:change={() => updateMessageList(currentConversationID)}
		>
			{#each conversationList as conversation}
				<option value={conversation.id}>{conversation.title}</option>
				<!-- Assuming each conversation has 'id' and 'title' -->
			{/each}
		</select>
	</div>

	<div id="message-container">
		{#each messageList as message}
			<div class="{message.role} message">{message.content}</div>
		{/each}

		<div class="user message">A</div>
		<div class="assistant message">B</div>
		<div class="system message">
			This is kinda long message that might need to be wrapped properly to fit within the container.
			I don't know how long it will be, but it should be able to handle long messages without
			breaking the layout.
		</div>
		<div class="error message">Error: Failed to load messages</div>
		<div class="loading message">Loading messages...</div>
	</div>

	<!-- <button on:click={main}> Refresh Conversations </button> -->

	<div id="input-container">
		<button>+</button>
		<input type="text" placeholder="메시지 입력" />
		<button>&#x27A4;</button>
	</div>
</div>

<style>
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
