/** Bounded transport. Provider response bodies and credentials never enter errors. */
export async function fetchJson(url: string, init: RequestInit = {}) {
	const endpoint = new URL(url);
	if (
		!["https:", "http:"].includes(endpoint.protocol) ||
		endpoint.username ||
		endpoint.password
	)
		throw new Error("INVALID_ENDPOINT");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const response = await fetch(endpoint, {
			...init,
			redirect: "error",
			signal: controller.signal,
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`UPSTREAM_HTTP_${response.status}`);
		}
		if (Number(response.headers.get("content-length")) > 2_000_000) {
			await response.body?.cancel();
			throw new Error("RESPONSE_TOO_LARGE");
		}
		const reader = response.body?.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		if (reader) {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > 2_000_000) {
					await reader.cancel();
					throw new Error("RESPONSE_TOO_LARGE");
				}
				chunks.push(value);
			}
		}
		if (!size)
			return response.headers.get("x-restli-id")
				? { id: response.headers.get("x-restli-id") }
				: null;
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw new Error("INVALID_RESPONSE");
		}
	} catch (error) {
		if (
			error instanceof Error &&
			/^(UPSTREAM_HTTP_[0-9]{3}|RESPONSE_TOO_LARGE|INVALID_RESPONSE)$/.test(
				error.message,
			)
		)
			throw error;
		throw new Error(
			controller.signal.aborted ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
		);
	} finally {
		clearTimeout(timer);
	}
}
