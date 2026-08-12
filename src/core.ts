export const SCREENSHOTONE_API_BASE_URL = "https://api.screenshotone.com";

export const MAX_API_RESPONSE_BYTES = 10 * 1024 * 1024;
const API_REQUEST_TIMEOUT_MS = 90_000;

export type ScreenshotOptions = {
    url: string;
    block_banners: boolean;
    block_ads: boolean;
    image_quality: number;
    full_page: boolean;
    response_type: "json" | "by_format";
    cache: boolean;
    cache_key?: string;
};

export type ApiResponse =
    | {
          ok: true;
          status: number;
          contentType: string;
          body: ArrayBuffer;
      }
    | { ok: false; status?: number; error: string };

export class ResponseTooLargeError extends Error {}

async function readBoundedBody(
    response: Response,
    maxBytes: number
): Promise<ArrayBuffer> {
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
        const declaredSize = Number(contentLength);
        if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
            await response.body?.cancel();
            throw new ResponseTooLargeError();
        }
    }

    if (!response.body) return new ArrayBuffer(0);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                throw new ResponseTooLargeError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body.buffer;
}

export function buildScreenshotUrl(
    {
        url,
        block_banners,
        block_ads,
        image_quality,
        full_page,
        response_type,
        cache,
        cache_key,
    }: ScreenshotOptions,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL
): string {
    const screenshotUrl = new URL("/take", apiBaseUrl);
    screenshotUrl.searchParams.set("url", url);
    screenshotUrl.searchParams.set("response_type", response_type);
    screenshotUrl.searchParams.set("cache", cache.toString());
    screenshotUrl.searchParams.set("format", "jpeg");
    screenshotUrl.searchParams.set("image_quality", image_quality.toString());
    screenshotUrl.searchParams.set(
        "block_cookie_banners",
        block_banners.toString()
    );
    screenshotUrl.searchParams.set(
        "block_banners_by_heuristics",
        block_banners.toString()
    );
    screenshotUrl.searchParams.set("block_ads", block_ads.toString());
    screenshotUrl.searchParams.set("full_page", full_page.toString());

    if (cache && cache_key) {
        screenshotUrl.searchParams.set("cache_key", cache_key);
    }

    return screenshotUrl.toString();
}

export async function makeApiRequest(
    url: string,
    apiKey: string,
    fetchFn: typeof fetch = fetch
): Promise<ApiResponse> {
    try {
        const response = await fetchFn(url, {
            headers: { "X-Access-Key": apiKey },
            signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            await response.body?.cancel();
            return {
                ok: false,
                status: response.status,
                error: `ScreenshotOne API request failed with status ${response.status}`,
            };
        }

        return {
            ok: true,
            status: response.status,
            contentType:
                response.headers.get("content-type") ??
                "application/octet-stream",
            body: await readBoundedBody(response, MAX_API_RESPONSE_BYTES),
        };
    } catch (error) {
        if (error instanceof ResponseTooLargeError) {
            return {
                ok: false,
                error: `ScreenshotOne API response exceeds ${MAX_API_RESPONSE_BYTES} bytes. Enable caching and request a JSON response to receive a cache URL instead.`,
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `ScreenshotOne API request failed: ${message}`,
        };
    }
}

/** Compatibility helper retained for consumers of the original CLI package. */
export async function makeScreenshotOneRequest<T>(
    url: string,
    apiKey: string,
    fetchFn: typeof fetch = fetch
): Promise<T | { error: string }> {
    const response = await makeApiRequest(url, apiKey, fetchFn);
    if (!response.ok) {
        return { error: response.error };
    }
    return response.body as T;
}

export async function takeScreenshot(
    options: ScreenshotOptions,
    apiKey: string,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL,
    fetchFn: typeof fetch = fetch
) {
    return makeApiRequest(
        buildScreenshotUrl(options, apiBaseUrl),
        apiKey,
        fetchFn
    );
}

export async function getUsage(
    apiKey: string,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL,
    fetchFn: typeof fetch = fetch
) {
    return makeApiRequest(
        new URL("/usage", apiBaseUrl).toString(),
        apiKey,
        fetchFn
    );
}

export function decodeText(body: ArrayBuffer) {
    return new TextDecoder().decode(body);
}

export function arrayBufferToBase64(body: ArrayBuffer) {
    const bytes = new Uint8Array(body);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize)
        );
    }
    return btoa(binary);
}
