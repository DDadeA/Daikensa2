<script>
	import { onMount } from 'svelte';
	import { Decoder } from '@msgpack/msgpack';

	const endpoint = 'https://image.novelai.net/ai/generate-image-stream';

	// Svelte reactive variables - much cleaner than getElementById!
	let positivePrompts =
		'{best quality},0.9::artist:kat {bu-kunn}::,0.9::artist: sumiyao {amam}::, 0.8::aritst:tianliang duohe fangdongye::,0.5::artist:pelican {s030}::, 0.5::artist:null {nyanpyoun}::, 0.9::artist:mignon::,{aritst:ie_{raarami}}, year 2024, year 2025,,1girl, librarian, upper body, gentle smile, blush, long silver hair, blue eyes, glasses, white blouse, black cardigan, holding an open book, in a library, bookshelves in background, soft lighting';
	let negativePrompts =
		'{{censored}}, {{normal quality, bad quality, low quality, worst quality, lowres, displeasing, bad anatomy, bad perspective, bad proportions, bad face, bad arm, bad hands, bad leg, bad feet, bad reflection, bad link, bad source, wrong hand, wrong feet, missing, missing limb, missing eye, missing tooth, missing ear, missing finger, extra, extra faces, extra eyes, extra mouth, extra ears, extra breasts, extra arms, extra hands, extra legs, extra digits, fewer digits, cropped, cropped head, cropped torso, cropped arms, cropped legs, JPEG artifacts, signature, watermark, username, blurry, artist name, fat, duplicate, mutation, deformed, disfigured, long neck, unfinished, chromatic aberration, scan, scan artifacts, abstract, @_@, brown skin, glasses, vertical lines, vertical banding}},';
	let selectedModel = 'nai-diffusion-4-5-full';
	let selectedSize = '832x1216';
	let isLoading = false;
	let apiKey = 'pst-SfD6nT9NtY0T84pBZJHcV73xWqnFjx5S6cjhik0awRk7dViaelvnQXUxsEB0kgrr';

	// Reactive variable to hold the final image URL
	let imageUrl = '';
	let progressMessage = 'Connecting to stream...';

	function getNAIRequestBody(positive_prompts, negative_prompts, model, size, seed) {
		const [width, height] = size.split('x').map(Number);

		// console.log(`🔧 Preparing NAI request body with size: ${width}x${height}`);

		return {
			action: 'generate',
			input: positive_prompts,
			model: model,
			parameters: {
				add_original_image: true,
				autoSmea: false,
				cfg_rescale: 0,
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
				scale: 5,
				seed: seed,
				skip_cfg_above_sigma: null,
				steps: 28,
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
	onMount(() => {
		// We create an AbortController to cancel the fetch request if the component unmounts
		const controller = new AbortController();

		async function startImageStream() {
			// Use the exact endpoint and body from your example
			const headers = {
				// It's safer to mimic the headers that you know work
				Accept: '*/*',
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`, // Use your API key here
				// It might be a good idea to include these too
				'x-correlation-id': '1PifIJ', // Or generate a new one
				'x-initiated-at': new Date().toISOString()
			};
			const body = getNAIRequestBody(
				positivePrompts,
				negativePrompts,
				selectedModel,
				selectedSize,
				Math.floor(Math.random() * 1000000000)
			);

			try {
				const response = await fetch(endpoint, {
					method: 'POST',
					headers: headers,
					body: JSON.stringify(body),
					signal: controller.signal // Link the abort controller
				});

				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				if (!response.body) {
					throw new Error('Response has no body.');
				}

				const decoder = new Decoder();

				progressMessage = 'Stream connected, receiving data...';

				// Use `for await...of` to consume the async iterator from decodeStream
				for await (const decodedObject of decoder.decodeStream(response.body)) {
					console.log('Decoded MessagePack Object:', decodedObject);

					// --- DATA HANDLING LOGIC ---
					// This logic remains the same as it depends on the API's object structure
					if (typeof decodedObject?.final === 'boolean' && decodedObject?.final === true) {
						// Sometimes the final chunk doesn't contain the image, it's a confirmation.
						// The image data usually arrives just before this.
						progressMessage = 'Image received!';
					} else if (decodedObject && typeof decodedObject.image === 'string') {
						// Check if the object has an image property that is a string
						const base64String = decodedObject.image;
						imageUrl = `data:image/png;base64,${base64String}`;
					} else if (decodedObject && typeof decodedObject.progress === 'number') {
						// Check if the object has progress info
						progressMessage = `Generating... ${Math.round(decodedObject.progress * 100)}%`;
					} else if (decodedObject?.error) {
						// Check for an error message from the API
						throw new Error(`API Error: ${decodedObject.error}`);
					}
				}

				console.log('Stream finished.');
				if (!imageUrl) {
					progressMessage = 'Stream finished, but no image was found in the data.';
				}
			} catch (error) {
				if (error.name === 'AbortError') {
					console.log('Fetch aborted on component unmount.');
				} else {
					console.error('Fetch stream error:', error);
					progressMessage = `Error: ${error.message}`;
				}
			}
		}
		startImageStream();

		// Cleanup function: This runs when the component is destroyed
		return () => {
			controller.abort();
		};
	});
</script>

<!-- In your Svelte component's HTML -->
<div>
	<p>{progressMessage}</p>
	{#if imageUrl}
		<img src={imageUrl} alt="Generated AI" style="max-width: 100%;" />
	{:else}
		<p>Waiting for image...</p>
	{/if}
</div>
