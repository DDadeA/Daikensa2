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
	import { tools, actualTool, cancelToolAwait } from '$lib/tools';
	import { streamingText, nai_api_key } from '$lib/stores';
	import { apiFetch } from '$lib/api';
	import { isAskingChoice, choiceOptions, handleChoice } from '$lib/tools';

	let loadingConversations: boolean = false;
	let loadingMessages: boolean = false;
	let isMessageStreaming = false; // Placeholder for streaming state

	let conversationList: Array<Conversation> = [];
	let currentConversationID: string = '';
	let messageList: Array<Message> = [];
	let tokenUsage = 0;

	let inputMessage: string = '';
	let inputDatas: File[] = [];
	let showFileInputModal: boolean = false;
	let showAudioRecorder: boolean = false;
	let isRecording: boolean = false;
	let mediaRecorder: MediaRecorder | null = null;
	let audioChunks: Blob[] = [];
	let recordingTime: number = 0;
	let recordingInterval: any | null = null;
	// let streamingText: string = ''; // Placeholder for streaming text

	let GEMINI_API_KEY: string;
	let GEMINI_MODEL: string;
	let GEMINI_TEMPERATURE: number;
	let GEMINI_THINKING: boolean;
	let GEMINI_INCLUDE_THINKING: boolean;
	let GEMINI_THINKING_BUDGET: number;
	let GEMINI_THINKING_LEVEL: 'low' | 'medium' | 'high';
	let GEMINI_SYSTEM_PROMPT: string;
	let GEMINI_DO_STREAMING: boolean; // Toggle for streaming mode

	let CUSTOM_TOOL_TOGGLE: boolean = true; // Toggle for tool usage
	let IMAGE_RECENT_LIMIT = 5; // Max number of recent images to keep in history

	let currentTheme: 'light' | 'dark' = 'light';
	let SHOW_IMAGE_OUTSIDE: boolean = false;

	const toggleShowImageOutside = () => {
		SHOW_IMAGE_OUTSIDE = !SHOW_IMAGE_OUTSIDE;
		localStorage.setItem('SHOW_IMAGE_OUTSIDE', SHOW_IMAGE_OUTSIDE ? 'true' : 'false');

		if (SHOW_IMAGE_OUTSIDE) {
			// Add style
			const style = document.createElement('style');
			style.id = 'show-image-outside-style';

			// Grab last .message from .message-container
			style.innerHTML = `
				#app {
					max-width: 50% !important;
					margin-right: 0;
				}
			.message-container > .message:last-child img {
				position: fixed;	
				max-height: 90%;

				max-width: 45%;
				left: 10px;
				}
			`;
			document.head.appendChild(style);sssssssssssssss
		} else {
			// Remove style
			const style = document.getElementById('show-image-outside-style');
			if (style) {
				style.remove();
			}
		}
	};

	const initializeFromLocalStorage = () => {
		GEMINI_API_KEY = localStorage.getItem('GEMINI_API_KEY') || '';
		GEMINI_MODEL = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-pro';
		GEMINI_TEMPERATURE = parseFloat(localStorage.getItem('GEMINI_TEMPERATURE') || '0.95');
		GEMINI_THINKING = localStorage.getItem('GEMINI_THINKING') === 'true';
		GEMINI_INCLUDE_THINKING = localStorage.getItem('GEMINI_INCLUDE_THINKING') === 'true';
		GEMINI_THINKING_BUDGET = parseInt(localStorage.getItem('GEMINI_THINKING_BUDGET') || '512', 10);
		GEMINI_THINKING_LEVEL =
			(localStorage.getItem('GEMINI_THINKING_LEVEL') as 'low' | 'medium' | 'high') || 'high';
		// GEMINI_SYSTEM_PROMPT =
		// localStorage.getItem('GEMINI_SYSTEM_PROMPT') || 'You are a helpful assistant.';
		currentTheme = (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
		GEMINI_DO_STREAMING = localStorage.getItem('GEMINI_DO_STREAMING') === 'true';

		// nai_api_key = localStorage.getItem('nai_api_key') || '';
		nai_api_key.set(localStorage.getItem('nai_api_key') || '');

		CUSTOM_TOOL_TOGGLE = localStorage.getItem('CUSTOM_TOOL_TOGGLE') === 'true';
		IMAGE_RECENT_LIMIT = parseInt(localStorage.getItem('IMAGE_RECENT_LIMIT') || '5', 10);
		SHOW_IMAGE_OUTSIDE = localStorage.getItem('SHOW_IMAGE_OUTSIDE') === 'true';

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

		window.onerror = (message, source, lineno, colno, error) => {
			console.error('Global error handler:', message, source, lineno, colno, error);
			alert(`Error: ${message}\nSource: ${source}\nLine: ${lineno}, Column: ${colno}`);
		};

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
						// Allow new line insertion at the cursor position
						const start = inputElement.selectionStart;
						const end = inputElement.selectionEnd;
						inputMessage =
							inputMessage.substring(0, start) +
							'\n' +
							inputMessage.substring(end, inputMessage.length);
						// Move the cursor to the right position after inserting the new line
						inputElement.selectionStart = inputElement.selectionEnd = start + 1;
						return;
					}

					// If it's recording, stop recording
					if (isRecording) {
						stopRecording();
						showAudioRecorder = false;
						setTimeout(() => {
							handleSend();
						}, 200); // Slight delay to ensure recording stops before sending
						return;
					}

					handleSend();
				}

				// LALT
				if (event.altKey && event.key.toLowerCase() === 't') {
					event.preventDefault();

					if (!isRecording) {
						startRecording();
						showAudioRecorder = true;
					} else {
						stopRecording();
						showAudioRecorder = false;
					}
				}
			});
		}

		// Ctrl + V for paste image
		document.addEventListener('paste', (event) => {
			const items = event.clipboardData?.items || [];
			for (const item of items) {
				if (item.kind === 'file') {
					const file = item.getAsFile();

					if (file) {
						addData(file);
						console.log('Pasted data file:', file);
						// event.preventDefault();
					}
				}
			}
		});
	});

	const initializeAuthToken = () => {
		// Get authToken from params
		const urlParams = new URLSearchParams(window.location.search);
		const authToken = urlParams.get('authToken');

		// If exists, save it into localstorage
		if (authToken) {
			localStorage.setItem('authToken', authToken);
			alert(`authToken saved: ${authToken}`);

			// Remove params
			urlParams.delete('authToken');
			window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
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
					console.log(data[0]);
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

		GEMINI_SYSTEM_PROMPT =
			(conversationList.find((conv) => conv.id === conversationID)?.settings || {}).systemPrompt ||
			'You are a helpful assistant.';

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
	const handleSend = async () => {
		if (isMessageStreaming) {
			console.warn('Message is currently being streamed. Please wait.');
			return; // Prevent sending a new message while streaming
		}

		cancelToolAwait();
		inputMessage = inputMessage.trim();

		if (inputMessage || inputDatas.length > 0) {
			if (AUTO_TIMESTAMP) {
				// KST
				const now = new Date();
				const kst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);

				const timestamp = `${kst.getFullYear().toString().slice(2)}년 ${kst.getMonth() + 1}월 ${kst.getDate()}일 ${kst.getHours()}시 ${kst.getMinutes()}분 ${kst.getSeconds()}초`;

				console.log(timestamp);
				// 결과: 25년 12월 27일 22시 24분 30초

				// Get current timestamp in KST
				inputMessage = `${timestamp}\n\n${inputMessage}`; // Prepend timestamp to the message
			}

			// Plan
			// - // Add it into messageList, send it to the llm api, then append it to the DB
			// alert(randomUUID());
			const newMessage: Message = {
				id: randomUUID(), // Generate a unique ID for the message
				conversation_id: currentConversationID,
				role: 'user',
				parts: [{ text: inputMessage }]
			};

			if (newMessage && inputDatas.length > 0) {
				for (const linedata of inputDatas) {
					newMessage.parts?.push({
						inlineData: {
							mimeType: linedata.type,
							data: await new Promise<string>((resolve, reject) => {
								const reader = new FileReader();
								reader.onload = () => {
									const base64String = (reader.result as string).split(',')[1]; // Extract base64 string
									resolve(base64String);
								};
								reader.onerror = (error) => reject(error);
								reader.readAsDataURL(linedata); // Read file as data URL
							})
						}
					});
				}
				inputDatas = []; // Clear input images after adding to context
			}

			// Remove images in history if exeedes IMAGE_RECENT_LIMIT

			const imageParts = messageList
				.flatMap((msg) => msg.parts || [])
				.filter((part) => part.inlineData && part.inlineData.data);
			if (imageParts.length >= IMAGE_RECENT_LIMIT) {
				const excessCount = imageParts.length - IMAGE_RECENT_LIMIT;
				let removedCount = 0;

				// Iterate through messageList to remove excess images
				let modifiedMessages = new Set<string | undefined>(); // To track which messages have been modified
				for (const msg of messageList) {
					if (removedCount >= excessCount) break; // Stop if we've removed enough images

					if (msg.parts) {
						msg.parts = msg.parts.filter((part) => {
							if (part.inlineData && part.inlineData.data && removedCount < excessCount) {
								removedCount++;
								modifiedMessages.add(msg.id);
								return false; // Remove this image part
							}
							return true; // Keep this part
						});
					}
				}

				// Also remove(apply changes) to the DB
				for (const msgId of modifiedMessages) {
					console.log(`Removed excess images from message ID: ${msgId}`);

					let msg = messageList.find((msg) => msg.id === msgId);

					apiFetch(`/api/message/`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							id: msgId,
							parts: msg?.parts || [],
							role: msg?.role || 'user',
							conversation_id: msg?.conversation_id || ''
							// created_at: msg?.created_at || new Date().toISOString(),
						})
					})
						.catch((error) => {
							console.error('Error updating message after removing images:', error);
						})
						.then((data) => {
							console.log('Message updated after removing images:', data);
						});
				}
			}

			// messageList = [...messageList]; // Trigger Svelte reactivity

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

		try {
			handleAPI(); // Call the function to handle API interaction
		} catch (error) {
			console.error('Error handling API interaction:', error);
			isMessageStreaming = false; // Reset streaming state on error
		}
	};

	const receive = async (context: any, streamingMessage: any, depth: number = 0) => {
		let body = {
			contents: context,
			system_instruction: {
				parts: [{ text: GEMINI_SYSTEM_PROMPT }]
			},
			tools: CUSTOM_TOOL_TOGGLE
				? tools
				: [
						{
							urlContext: {}
						},
						{
							codeExecution: {}
						},
						{
							googleSearch: {}
						}
					],
			generation_config: {
				maxOutputTokens: 8192,
				temperature: GEMINI_TEMPERATURE,
				topP: 0.9,
				topK: 128,
				thinkingConfig: {
					includeThoughts: GEMINI_INCLUDE_THINKING
				},
				mediaResolution: 'MEDIA_RESOLUTION_MEDIUM'
			},
			safetySettings: [
				{
					category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_HARASSMENT,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
					threshold: HarmBlockThreshold.BLOCK_NONE
				}
			]
		};

		// if gemini 3.0 series, set thinkingLevel. else thinkingBudget
		if (GEMINI_MODEL.startsWith('gemini-3')) {
			body.generation_config.thinkingConfig = {
				thinkingLevel: GEMINI_THINKING ? GEMINI_THINKING_LEVEL || 'high' : 'off',
				includeThoughts: GEMINI_INCLUDE_THINKING
			};
		} else {
			body.generation_config.thinkingConfig = {
				thinkingBudget: GEMINI_THINKING ? GEMINI_THINKING_BUDGET : 0,
				includeThoughts: GEMINI_INCLUDE_THINKING
			};
		}
		let response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
			{
				credentials: 'omit',
				headers: {
					// 'Accept-Language': 'ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3',
					'Content-Type': 'application/json',
					Connection: 'keep-alive',
					'Keep-Alive': 'timeout=10, max=200'
				},
				referrer: document.location.href,
				body: JSON.stringify(body),
				method: 'POST',
				mode: 'cors'
			}
		);

		let data = await response.json();
		// console.log('Received full response:', data);
		tokenUsage = data?.usageMetadata?.totalTokenCount || -1;

		if (!(data.candidates && data.candidates.length > 0)) {
			console.warn('No candidates found in the chunk');
			// throw new Error('No candidates found in the response chunk');
			// return streamingMessage; // Return the empty streaming message

			// Retry
			if (depth < 3) {
				console.warn(`Retrying receive() due to missing candidates (attempt ${depth + 1})`);
				streamingText.set(`Receive attempt(candidates) ${depth + 1}`); // Reset streaming text
				return await receive(context, streamingMessage, depth + 1);
			} else {
				console.error('Max retry attempts reached. Returning empty streaming message.');
				return streamingMessage; // Return the empty streaming message after retries
			}
		}

		// If the chunk contains candidates, process the first candidate
		let candidate = data.candidates[0];

		if (!candidate.content || !candidate.content.parts) {
			console.warn('No content parts found in the candidate, trying next candidate');

			console.log('candidate[0]', candidate);
			console.log(' > candidates', data.candidates);
			// throw new Error('No content parts found in the candidate');
			// return streamingMessage; // Return the empty streaming message

			// Retry
			if (depth < 3) {
				console.warn(`Retrying receive() due to missing content parts (attempt ${depth + 1})`);
				streamingText.set(`Receive attempt ${depth + 1}`); // Reset streaming text
				return await receive(context, streamingMessage, depth + 1);
			} else {
				console.error('Max retry attempts reached. Returning empty streaming message.');
				return streamingMessage; // Return the empty streaming message after retries
			}
		}

		//@ts-ignore
		for (let part of candidate.content.parts) {
			// Remove thoughtSignature
			if (part.thoughtSignature) {
				delete part.thoughtSignature; // Remove thoughtSignature from the part
			}
			// If part.text is not empty, append it to the streaming message
			streamingMessage.parts.push(part); // Append each part to the streaming message

			if (part.text) {
				$streamingText += part.text.replaceAll('\\n', '\n'); // Append text to streamingText if it exists
				// Force Svelte to trigger reactivity and update DOM
				// await tick();
			}
		}

		// scroll to streaming message
		scrollToBottom();
		return streamingMessage; // Return the final streaming message
	};

	const importFile = (isImage: boolean = false) => {
		// If not recording, Open the file picker
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = isImage ? 'image/*' : '*/*';
		fileInput.onchange = (event) => {
			if (!event.target) return;
			const files = event.target.files;

			if (files && files.length > 0) {
				const file = files[0];
				addData(file);
			}
		};
		fileInput.click();
	};

	const startRecording = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			mediaRecorder = new MediaRecorder(stream);
			audioChunks = [];
			recordingTime = 0;

			mediaRecorder.ondataavailable = (event) => {
				audioChunks.push(event.data);
			};

			mediaRecorder.onstop = () => {
				const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
				const audioFile = new File([audioBlob], `recording-${Date.now()}.webm`, {
					type: 'audio/webm'
				});
				addData(audioFile);

				// Clean up
				stream.getTracks().forEach((track) => track.stop());
				if (recordingInterval) {
					clearInterval(recordingInterval);
					recordingInterval = null;
				}
			};

			mediaRecorder.start();
			isRecording = true;

			// Start timer
			recordingInterval = setInterval(() => {
				recordingTime++;
			}, 1000);
		} catch (error) {
			console.error('Error accessing microphone:', error);
			alert(
				'Error accessing microphone. Please make sure you have given permission to use the microphone.'
			);
		}
	};

	const stopRecording = () => {
		if (mediaRecorder && mediaRecorder.state === 'recording') {
			mediaRecorder.stop();
			isRecording = false;
			showAudioRecorder = false;
		}
	};

	const cancelRecording = () => {
		if (mediaRecorder) {
			if (mediaRecorder.state === 'recording') {
				mediaRecorder.stop();
			}
			// Clean up without saving
			if (recordingInterval) {
				clearInterval(recordingInterval);
				recordingInterval = null;
			}
			const stream = mediaRecorder.stream;
			if (stream) {
				stream.getTracks().forEach((track) => track.stop());
			}
		}
		isRecording = false;
		showAudioRecorder = false;
		audioChunks = [];
		recordingTime = 0;
	};

	const formatTime = (seconds: number): string => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	};

	const addData = (inlineData?: any) => {
		if (!inlineData) {
			showFileInputModal = true;

			return;
		}
		console.log('Adding data:', inlineData);
		inputDatas = [...inputDatas, inlineData];
	};

	const handleAPI = async () => {
		scrollToBottom();
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

		GEMINI_DO_STREAMING
			? await receiveStream(context, streamingMessage)
			: await receive(context, streamingMessage);

		// Streaming complete
		isMessageStreaming = false;

		// Remove thoughtSignature

		// Merging text parts in streamingMessage parts
		// -- // Filter if any text part
		const textParts = streamingMessage.parts.filter((part) => part.text);

		if (textParts.length > 0) {
			const MergedText = textParts.map((part) => part.text?.replaceAll('\\n', '\n')).join('');

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

		for (const part of streamingMessage.parts) {
			if (!part.functionCall?.name) {
				continue;
			}

			// Handle the function call here, e.g., execute the function or log it
			// @ts-ignore
			const functionName = part.functionCall.name as keyof typeof actualTool;
			if (!actualTool[functionName]) {
				console.error(`Function ${functionName} is not defined in actualTool`);
				continue; // Skip if the function is not defined
			}

			// Call the actual tool function
			//@ts-ignore
			const toolResult = await actualTool[functionName](part.functionCall.args);
			console.log('Function call result:', toolResult);

			if (toolResult == null) {
				console.warn(`Function ${functionName} intentionally returned null. Skipping response.`);
				continue; // Skip sending a response if the function returned null
			}

			//  handle the result here, send it back to the LLM

			// Append the result to the streaming message content
			const resultMessage: Message = {
				id: randomUUID(),
				conversation_id: currentConversationID,
				role: toolResult.role || 'user',
				parts: [
					toolResult.data as any // Assuming toolResult is of type Part
				]
			};

			messageList = [...messageList, { ...resultMessage }];

			// POST the result message to the API
			await postOriginalPromise; // Ensure the original message is posted first

			apiFetch(`/api/message`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(resultMessage)
			});

			scrollToBottom();

			if (toolResult.sendBack) {
				handleAPI(); // Call the API handler to process the result message
			}
		}
	};

	const receiveStream = async (context: any, streamingMessage: any) => {
		[];
		let body = {
			contents: context,
			system_instruction: {
				parts: [{ text: GEMINI_SYSTEM_PROMPT }]
			},
			tools: CUSTOM_TOOL_TOGGLE
				? tools
				: [
						{
							urlContext: {}
						},
						{
							codeExecution: {}
						},
						{
							googleSearch: {}
						}
					],
			generation_config: {
				maxOutputTokens: 8192,
				temperature: GEMINI_TEMPERATURE,
				topP: 0.9,
				topK: 128,
				thinkingConfig: {
					includeThoughts: GEMINI_INCLUDE_THINKING
				},
				mediaResolution: 'MEDIA_RESOLUTION_MEDIUM'
			},
			safetySettings: [
				{
					category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_HARASSMENT,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
					threshold: HarmBlockThreshold.BLOCK_NONE
				},
				{
					category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
					threshold: HarmBlockThreshold.BLOCK_NONE
				}
			]
		};

		// if gemini 3.0 series, set thinkingLevel. else thinkingBudget
		if (GEMINI_MODEL.startsWith('gemini-3')) {
			body.generation_config.thinkingConfig = {
				thinkingLevel: GEMINI_THINKING ? GEMINI_THINKING_LEVEL || 'high' : 'off',
				includeThoughts: GEMINI_INCLUDE_THINKING
			};
		} else {
			body.generation_config.thinkingConfig = {
				thinkingBudget: GEMINI_THINKING ? GEMINI_THINKING_BUDGET : 0,
				includeThoughts: GEMINI_INCLUDE_THINKING
			};
		}

		try {
			let response = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?key=${GEMINI_API_KEY}&alt=sse`,
				{
					credentials: 'omit',
					headers: {
						// Accept: '*/*',
						'Accept-Language': 'ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3',
						'Content-Type': 'application/json'
					},
					referrer: document.location.href,
					body: JSON.stringify(body),
					method: 'POST',
					mode: 'cors'
				}
			);

			// for await (const chunk of response) {
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('Response body is not readable');
			}
			while (true) {
				const raw_data = (await reader.read()) as any;
				// console.log('Received chunk:', chunk);

				if (!raw_data) {
					console.warn('Received empty chunk');
					continue;
				}
				if (raw_data.done) {
					console.log('Stream finished');
					break; // Exit the loop if the stream is done
				}

				let raw_text = new TextDecoder()
					.decode(raw_data.value)
					.replace(/data: /g, '')
					.trim();
				// SSE format! wow.

				// console.log('Received raw text:', raw_text);

				// split\n\n, // and parse each chunk
				let chunks = raw_text.split(/\r?\n\r?\n/g).map((line) => {
					console.log('Received line:', line, '[END]');
					if (!line) {
						console.warn('Received empty line, skipping');
						return null; // Skip empty lines
					}

					// Parse the JSON line
					return JSON.parse(line.replaceAll('\n', '\\n'));
				});

				if (chunks.length > 1) {
					console.warn('Received multiple chunks in a single read:', chunks);
				}
				for (const chunk of chunks) {
					if (!(chunk.candidates && chunk.candidates.length > 0)) {
						console.warn('No candidates found in the chunk');
						continue; // Skip if no candidates are found
					}

					// If the chunk contains candidates, process the first candidate
					let candidate = chunk.candidates[0];

					if (!candidate.content || !candidate.content.parts) {
						console.warn('No content parts found in the candidate, trying next candidate');

						console.log('candidate[0]', candidate);
						console.log(' > candidates', chunk.candidates);
						continue;
					}

					//@ts-ignore
					for (let part of candidate.content.parts) {
						// Remove thoughtSignature
						if (part.thoughtSignature) {
							delete part.thoughtSignature; // Remove thoughtSignature from the part
						}
						// If part.text is not empty, append it to the streaming message
						streamingMessage.parts.push(part); // Append each part to the streaming message

						if (part.text) {
							$streamingText += part.text.replaceAll('\\n', '\n'); // Append text to streamingText if it exists
							// Force Svelte to trigger reactivity and update DOM
							// await tick();
						}
					}

					// scroll to streaming message
					scrollToBottom();
				}
			}
		} catch (error) {
			console.error('Error during LLM API call:', error);
			isMessageStreaming = false; // Reset streaming state on error

			// alert('SYSTEM ERROR: ' + error);
			return; // Exit the function on error
		}

		return streamingMessage; // Return the final streaming message
	};
</script>

<title>ONLY DAIKENSA V2</title>
<div id="app">
	<!-- Main application container -->
	<details>
		<summary
			>{conversationList.find((convo) => convo.id === currentConversationID)?.title}
			{tokenUsage > 0 ? ` - (${tokenUsage} tokens)` : ''}</summary
		>
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

					<span class="vertical-line"></span>
					<label for="show-Image-outside">Show Images Outside(experiment)</label>
					<button onclick={() => toggleShowImageOutside()}>
						{SHOW_IMAGE_OUTSIDE ? 'ON' : 'OFF'}
					</button>
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
						{#each ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as model}
							<option value={model}>{model}</option>
						{/each}
					</select>
					<span class="vertical-line"></span>
					<label for="thinking-checkbox">Thinking</label>
					<input
						type="checkbox"
						id="thinking-checkbox"
						bind:checked={GEMINI_THINKING}
						onclick={(event) =>
							localStorage.setItem(
								'GEMINI_THINKING',
								(event.target as HTMLInputElement).checked.toString()
							)}
					/>
					<span class="vertical-line"></span>
					<label for="include-thinking-checkbox">Include Thinking</label>
					<input
						type="checkbox"
						id="include-thinking-checkbox"
						bind:checked={GEMINI_INCLUDE_THINKING}
						onclick={(event) =>
							localStorage.setItem(
								'GEMINI_INCLUDE_THINKING',
								(event.target as HTMLInputElement).checked.toString()
							)}
					/>
					<span class="vertical-line"></span>
					{#if GEMINI_MODEL !== 'gemini-3-pro-preview'}
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
					{:else}
						<select
							bind:value={GEMINI_THINKING_LEVEL}
							onchange={() => localStorage.setItem('GEMINI_THINKING_LEVEL', GEMINI_THINKING_LEVEL)}
						>
							{#each ['low', 'medium', 'high'] as level}
								<option value={level}>{level}</option>
							{/each}
						</select>
					{/if}

					<span class="vertical-line"></span>
					<label for="do-streaming-checkbox">do streaming</label>
					<input
						type="checkbox"
						id="do-streaming-checkbox"
						bind:checked={GEMINI_DO_STREAMING}
						onclick={(event) =>
							localStorage.setItem(
								'GEMINI_DO_STREAMING',
								(event.target as HTMLInputElement).checked.toString()
							)}
					/>

					<span class="vertical-line"></span>
					<span>Temp: {GEMINI_TEMPERATURE}</span>
					<input
						type="range"
						placeholder="Temperature"
						bind:value={GEMINI_TEMPERATURE}
						oninput={() =>
							localStorage.setItem('GEMINI_TEMPERATURE', GEMINI_TEMPERATURE.toString())}
						min="0"
						max="1"
						step="0.01"
					/>
					<br />
					<span>IMAGE_RECENT_LIMIT: {IMAGE_RECENT_LIMIT}</span>
					<input
						type="number"
						placeholder="IMAGE_RECENT_LIMIT"
						bind:value={IMAGE_RECENT_LIMIT}
						oninput={() =>
							localStorage.setItem('IMAGE_RECENT_LIMIT', IMAGE_RECENT_LIMIT.toString())}
						min="0"
						max="30"
						step="1"
					/>
					<br />
					<label for="use-custom-tool-checkbox">Use Custom Tools</label>
					<input
						type="checkbox"
						id="use-custom-tool-checkbox"
						bind:checked={CUSTOM_TOOL_TOGGLE}
						onclick={(event) =>
							localStorage.setItem(
								'CUSTOM_TOOL_TOGGLE',
								(event.target as HTMLInputElement).checked.toString()
							)}
					/>
					<span class="vertical-line"></span>
					<br />
					<span>GEMINI_API_KEY</span>
					<input
						type="password"
						placeholder="API_KEY"
						bind:value={GEMINI_API_KEY}
						oninput={() => localStorage.setItem('GEMINI_API_KEY', GEMINI_API_KEY)}
					/>
					<br />
					<span>NAI_API_KEY</span>
					<input
						type="password"
						placeholder="NAI_API_KEY"
						bind:value={$nai_api_key}
						oninput={(e) => {
							// nai_api_key.set((e.target as HTMLInputElement).value);

							localStorage.setItem('nai_api_key', (e.target as HTMLInputElement).value);
						}}
					/>
					<textarea
						placeholder="system prompt"
						bind:value={GEMINI_SYSTEM_PROMPT}
						oninput={() =>
							// Fetch to conversation
							apiFetch(`/api/conversation/`, {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json'
								},
								body: JSON.stringify({
									id: currentConversationID,
									title: conversationList.find((convo) => convo.id === currentConversationID)
										?.title,
									settings: {
										systemPrompt: GEMINI_SYSTEM_PROMPT
									}
								})
							})
								.then(() => {
									// Successfully updated system prompt
								})
								.catch((error) => {
									console.error('Error updating system prompt:', error);
								})}
					></textarea>
					<br />
				</div>
			</details>
		</div>
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
					editMessage={async () => {
						await apiFetch(`/api/message/`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({
								id: message.id,
								conversation_id: message.conversation_id,
								role: message.role,
								parts: message.parts,
								created_at: message.created_at
							})
						});
					}}
				/>
			{/each}
		{/if}
		{#if isMessageStreaming}
			<div class="model message">
				<MessageElement message={streamingMessage} isStreaming={isMessageStreaming} />
			</div>
		{/if}
	</div>

	<div id="input-container">
		<button
			onclick={() => {
				showFileInputModal = true;
			}}>+</button
		>
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
	{#if $isAskingChoice}
		<div class="choice-prompt">
			<!-- <p>Please select an option:</p> -->
			<ul>
				{#each $choiceOptions as option}
					<li onclick={() => handleChoice(option)}>{option}</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if inputDatas.length > 0}
		<div class="image-preview">
			{#each inputDatas as inlineData}
				<div>
					<button
						onclick={() => {
							inputDatas = inputDatas.filter((img) => img !== inlineData);
						}}
						aria-label="Remove image"
						style="position: absolute; margin-left: -10px; margin-top: -10px; z-index: 10; background-color: red; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 14px; line-height: 18px; text-align: center; cursor: pointer;"
						>×</button
					>
					{#if inlineData.type.startsWith('video/')}
						<video
							src={URL.createObjectURL(inlineData)}
							controls
							style="max-width: 200px; max-height: 200px; border: 1px solid var(--border-primary); border-radius: 4px;"
						></video>
					{:else if inlineData.type.startsWith('audio/')}
						<audio
							src={URL.createObjectURL(inlineData)}
							controls
							style="max-width: 200px; max-height: 50px; border: 1px solid var(--border-primary); border-radius: 4px;"
						></audio>
					{:else}
						<img src={URL.createObjectURL(inlineData)} alt="User uploaded image?" />
					{/if}
				</div>
			{/each}
		</div>
		<!-- <div style="width: 100%; height: 1px; border-bottom: 1px solid var(--border-primary); margin: 10px 0;"></div> -->
	{/if}
	{#if showFileInputModal}
		<div class="file-input-modal">
			<!-- Image / File / Recording Audio -->
			<!-- Image icon -->
			<button onclick={() => importFile(true)}>Image</button>
			<button onclick={() => importFile(false)}>File</button>
			<button
				onclick={() => {
					showAudioRecorder = true;
					showFileInputModal = false;
					startRecording();
				}}>Record Audio</button
			>
			<button onclick={() => (showFileInputModal = false)}>Close</button>
		</div>
	{/if}
	{#if showAudioRecorder}
		<div class="audio-recorder-modal">
			<div class="recorder-content">
				<h3>Audio Recorder</h3>
				<div class="recorder-controls">
					{#if !isRecording}
						<button class="record-button" onclick={() => startRecording()}>
							<span class="record-icon">🎤</span>
							Start Recording
						</button>
					{:else}
						<div class="recording-indicator">
							<span class="pulse-dot"></span>
							Recording: {formatTime(recordingTime)}
						</div>
						<div class="recording-buttons">
							<button class="stop-button" onclick={() => stopRecording()}>
								<span>⏹️</span>
								Stop
							</button>
							<button
								class="send-button"
								onclick={() => {
									stopRecording();
									setTimeout(() => {
										handleSend();
									}, 200);
								}}
							>
								<span>⏫</span>
								Sending NOW
							</button>
							<button class="cancel-button" onclick={() => cancelRecording()}>
								<span>❌</span>
								Cancel
							</button>
						</div>
					{/if}
				</div>
				{#if !isRecording}
					<button class="close-button" onclick={() => (showAudioRecorder = false)}>Close</button>
				{/if}
			</div>
		</div>
	{/if}
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
	.choice-prompt {
		position: fixed;
		top: 50px;
		left: 50%;
		transform: translateX(-50%);
		background-color: var(--bg-secondary);
		color: var(--text-primary);
		padding: 10px;
		border-radius: 8px;
		box-shadow: 0 2px 10px var(--shadow-medium);
		z-index: 1000;

		width: 80%;
		max-width: 600px;

		display: flex;
		flex-direction: column;
		gap: 10px;

		opacity: 0.8;
	}
	.choice-prompt p {
		margin: 0;
		font-size: 16px;
	}
	.choice-prompt ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.choice-prompt li {
		padding: 20px;
		padding-left: 10px;
		padding-right: 10px;

		background-color: var(--bg-tertiary);
		border-radius: 4px;
		cursor: pointer;
		transition: background-color 0.3s ease;
	}
	.choice-prompt li:hover {
		background-color: var(--bg-hover);
	}
	.choice-prompt li:active {
		background-color: var(--bg-active);
	}

	.image-preview {
		position: fixed;
		bottom: 100px;
		left: 50%;
		transform: translateX(-50%);
		width: 80%;
		max-width: 600px;
		min-height: 100px;
		max-height: 200px;
		overflow-x: auto;

		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 10px;
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		padding: 10px;
		background-color: var(--bg-secondary);
	}
	.image-preview img {
		max-height: 150px;
		border-radius: 4px;
	}

	.file-input-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: var(--bg-secondary);
		color: var(--text-primary);
		padding: 20px;
		border-radius: 8px;
		box-shadow: 0 4px 20px var(--shadow-medium);
		z-index: 1000;
		border: 1px solid var(--border-primary);

		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 250px;
	}

	.file-input-modal button {
		padding: 12px 16px;
		border: 1px solid var(--border-primary);
		border-radius: 4px;
		background-color: var(--bg-tertiary);
		color: var(--text-primary);
		cursor: pointer;
		transition: background-color 0.3s ease;
		font-size: 14px;
	}

	.file-input-modal button:hover {
		background-color: var(--bg-hover);
	}

	.audio-recorder-modal {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1001;
	}

	.recorder-content {
		background-color: var(--bg-secondary);
		color: var(--text-primary);
		padding: 30px;
		border-radius: 12px;
		box-shadow: 0 8px 32px var(--shadow-medium);
		border: 1px solid var(--border-primary);
		min-width: 300px;
		text-align: center;
	}

	.recorder-content h3 {
		margin: 0 0 20px 0;
		font-size: 18px;
		font-weight: 600;
	}

	.recorder-controls {
		display: flex;
		flex-direction: column;
		gap: 15px;
		align-items: center;
	}

	.record-button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 15px 25px;
		border: 2px solid #dc3545;
		border-radius: 50px;
		background-color: #dc3545;
		color: white;
		cursor: pointer;
		font-size: 16px;
		font-weight: 600;
		transition: all 0.3s ease;
	}

	.record-button:hover {
		background-color: #c82333;
		border-color: #c82333;
		transform: translateY(-2px);
	}

	.record-icon {
		font-size: 18px;
	}

	.recording-indicator {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 18px;
		font-weight: 600;
		color: #dc3545;
	}

	.pulse-dot {
		width: 12px;
		height: 12px;
		background-color: #dc3545;
		border-radius: 50%;
		animation: pulse 1s infinite;
	}

	@keyframes pulse {
		0% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.5;
			transform: scale(1.2);
		}
		100% {
			opacity: 1;
			transform: scale(1);
		}
	}

	.recording-buttons {
		display: flex;
		gap: 15px;
	}
	.send-button,
	.stop-button,
	.cancel-button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		border: 2px solid;
		border-radius: 8px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 500;
		transition: all 0.3s ease;
	}

	.stop-button {
		border-color: #28a745;
		background-color: #28a745;
		color: white;
	}
	.send-button {
		border-color: #007bff;
		background-color: #007bff;
		color: white;
	}
	.send-button:hover {
		background-color: #0069d9;
		border-color: #0069d9;
	}

	.stop-button:hover {
		background-color: #218838;
		border-color: #218838;
	}

	.cancel-button {
		border-color: #6c757d;
		background-color: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.cancel-button:hover {
		background-color: var(--bg-hover);
	}

	.close-button {
		margin-top: 15px;
		padding: 10px 20px;
		border: 1px solid var(--border-primary);
		border-radius: 6px;
		background-color: var(--bg-tertiary);
		color: var(--text-primary);
		cursor: pointer;
		transition: background-color 0.3s ease;
	}

	.close-button:hover {
		background-color: var(--bg-hover);
	}
</style>
