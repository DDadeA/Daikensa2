<script lang="ts">
	import { marked } from 'marked';
	import { streamingText } from '$lib/stores';
	import type { Message } from '$lib/types';

	export let message: Message;
	export let deleteMessage = () => {};
	export let editMessage = async () => {};
	export let isStreaming = false;

	let isEditing = false;
	let partsString = JSON.stringify(message.parts);
	// export let streamingText: string = '';
</script>

<div id={message.id} class="{message.role} message">
	{#if message.role === 'model'}
		<span class="message-content">
			{#if isStreaming}
				<span class="thinking"></span>
				{@html marked.parse($streamingText || '')}
			{:else if isEditing}
				<textarea bind:value={partsString}></textarea>
			{:else}
				{#each message.parts || [] as part}
					<!-- {JSON.stringify(part)} -->

					{#if part.text && part.text.length > 0}
						{@html marked.parse(part.text)}
					{:else}
						<details>{JSON.stringify(part)}</details>
					{/if}
				{/each}
			{/if}
		</span>
	{/if}
	<div class="button-container">
		<div role="button" class="delete-button" onclick={() => deleteMessage()}></div>
		<div
			role="button"
			class="edit-button"
			onclick={() => {
				// Make text part editable
				if (!isEditing) {
					isEditing = true;
				} else {
					isEditing = false;

					try {
						// try JSON.parse this value
						const newParts = JSON.parse(partsString);

						// If okay, then apply it into message
						message.parts = newParts;

						// Then run the editMessage function
						editMessage();
					} catch (error) {
						console.error('Failed to parse JSON:', error);
					}
				}
			}}
		></div>
	</div>
	{#if message.role === 'user'}
		<span class="message-content">
			{#if isEditing}
				<textarea bind:value={partsString}></textarea>
			{:else}
				{#each message.parts || [] as part}
					<!-- {JSON.stringify(part)} -->

					{#if part.text && part.text.length > 0}
						{@html marked.parse(part.text)}
					{:else if part.inlineData && part.inlineData.data}
						{#if part.inlineData.data.startsWith('data:image')}
							<img
								src={part.inlineData.data}
								alt="User uploaded image"
								style=" max-width: 70%; border-radius: 4px;"
							/>
						{:else}
							<img
								src={`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`}
								alt="User uploaded image"
								style=" max-width: 70%; border-radius: 4px;"
							/>
						{/if}
					{:else}
						<details>{JSON.stringify(part)}</details>
					{/if}
				{/each}
			{/if}
		</span>
	{/if}
</div>

<style>
	.message {
		margin-left: 10px;
		margin-right: 10px;

		max-width: 90%;
		width: 90%;

		display: flex;
		flex-direction: row;

		gap: 10px;
	}

	.user,
	.system {
		/* Stick it to the right side */
		margin-left: auto;
		justify-content: right;
	}

	.model {
		/* Stick it to the left side */
		margin-right: auto;
		justify-content: left;
	}

	.message-content {
		/* padding: 10px; */
		width: fit-content;

		max-width: 100%;

		word-break: break-word;
		/* text-wrap-mode: wrap; */

		overflow-wrap: break-word;
		overflow-x: scroll;

		padding-left: 10px;
		padding-right: 10px;
		border-radius: 4px;

		background-color: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		color: var(--text-primary);

		transition:
			background-color 0.3s ease,
			border-color 0.3s ease,
			color 0.3s ease;
	}

	.delete-button {
		width: 20px;
		height: 20px;
	}
	.message:hover {
		max-width: calc(90% + 23.5px);
	}

	.button-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;

		visibility: hidden;
		opacity: 0;

		transition:
			visibility 0s,
			opacity 0.1s linear;
	}

	.message:hover > .button-container {
		visibility: visible;
		opacity: 1;
	}

	.button-container > * {
		width: 16px;
		height: 16px;

		cursor: pointer;
		margin: 3px;
		border: 1px solid var(--border-primary);
		border-radius: 50%;
		background-color: var(--bg-secondary);

		transition:
			background-color 0.3s ease,
			border-color 0.3s ease;
	}

	.button-container > *:hover {
		background-color: var(--bg-hover);
	}

	.delete-button {
		content: url('https://api.iconify.design/line-md/trash.svg?color=%23666');
	}

	:global([data-theme='dark']) .delete-button {
		content: url('https://api.iconify.design/line-md/trash.svg?color=white');
	}

	.edit-button {
		content: url('https://api.iconify.design/line-md/pencil-alt-twotone.svg?color=%23666');
	}

	:global([data-theme='dark']) .edit-button {
		content: url('https://api.iconify.design/line-md/pencil-alt-twotone.svg?color=white');
	}

	.thinking {
		content: url('https://api.iconify.design/line-md/loading-alt-loop.svg?color=%23666');
		margin: auto;
		width: 45px;
		height: 45px;
	}

	:global([data-theme='dark']) .thinking {
		content: url('https://api.iconify.design/line-md/loading-alt-loop.svg?color=white');
	}

	code {
		color: var(--text-primary);
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		padding: 2px 4px;
		font-family: monospace;

		display: inline-block;
		margin: 2px 0;

		transition:
			background-color 0.3s ease,
			border-color 0.3s ease,
			color 0.3s ease;
	}

	:global([data-theme='dark'] code) {
		background-color: #1e1e1e;
		color: #d4d4d4;
	}

	/* 마크다운 스타일링 */
	:global(.message-content h1),
	:global(.message-content h2),
	:global(.message-content h3),
	:global(.message-content h4),
	:global(.message-content h5),
	:global(.message-content h6) {
		color: var(--text-primary);
		margin-top: 1em;
		margin-bottom: 0.5em;
	}

	:global(.message-content p) {
		color: var(--text-primary);
		margin: 0.5em 0;
	}

	:global(.message-content ul),
	:global(.message-content ol) {
		color: var(--text-primary);
		margin-left: 1.5em;
	}

	:global(.message-content blockquote) {
		border-left: 4px solid var(--border-primary);
		padding-left: 1em;
		margin: 1em 0;
		color: var(--text-secondary);
		background-color: var(--bg-primary);
		border-radius: 0 4px 4px 0;
	}

	:global(.message-content pre) {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		padding: 1em;
		overflow-x: auto;
		margin: 1em 0;
	}

	:global(.message-content pre code) {
		background: none;
		border: none;
		padding: 0;
		margin: 0;
	}
</style>
