<script>
	import { marked } from 'marked';

	export let message;
	export let deleteMessage;
	export let isStreaming;

	// console.log('MessageElement Parts', message.metadata?.parts);
</script>

<div id={message.id} class="{message.role} message">
	{#if message.role === 'model'}
		<span class="message-content">
			{#if message.content == ''}
				{#if message.metadata?.parts.length > 0}
					{#each message.metadata?.parts as part}
						{#if part.functionCall}
							<code
								>Function {part.functionCall.name}({JSON.stringify(part.functionCall.args)})</code
							>
						{:else}
							?
						{/if}
					{/each}
				{:else}
					-
				{/if}
			{:else}
				{@html marked.parse(message.content)}
			{/if}
		</span>
	{/if}
	<div class="button-container">
		<div
			role="button"
			class="delete-button"
			onclick={() => deleteMessage()}
			ontouchend={() => deleteMessage()}
		></div>
		<div
			role="button"
			class="edit-button"
			onclick={() => console.log('Edit message')}
			ontouchend={() => console.log('Edit message')}
		></div>
	</div>
	{#if message.role === 'user'}
		<span class="message-content">
			{@html marked.parse(message.content)}

			{JSON.stringify(message.metadata?.parts)}
		</span>
	{/if}
</div>

<style>
	.message {
		margin-left: 10px;
		margin-right: 10px;

		max-width: 80%;
		width: 80%;

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
		text-wrap-mode: wrap;

		overflow-wrap: break-word;
		overflow-x: scroll;

		padding-left: 10px;
		padding-right: 10px;
		border-radius: 4px;

		background-color: #f0f0f0;
		border: 1px solid #ccc;
	}

	.delete-button {
		width: 20px;
		height: 20px;
	}
	.message:hover {
		max-width: calc(80% + 23.5px);
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
		border: 1px solid #ccc;
		border-radius: 50%;
	}

	.delete-button {
		content: url('https://api.iconify.design/line-md/trash.svg?color=black');
	}

	.edit-button {
		content: url('https://api.iconify.design/line-md/pencil-alt-twotone.svg?color=black');
	}

	.thinking {
		content: url('https://api.iconify.design/line-md/loading-alt-loop.svg?color=black');
		margin: auto;
		width: 45px;
		height: 45px;
	}

	code {
		color: white;
		background-color: #2f2f2f;
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 2px 4px;
		font-family: monospace;

		display: inline-block;
		margin: 2px 0;
	}
</style>
