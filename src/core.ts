export const SCREENSHOTONE_API_BASE_URL = "https://api.screenshotone.com";

export const MAX_API_RESPONSE_BYTES = 10 * 1024 * 1024;
const API_REQUEST_TIMEOUT_MS = 90_000;

export type ScreenshotOptions = {
    url: string;
    block_banners: boolean;
    block_ads: boolean;
    image_quality: number;
    full_page: boolean;
    full_page_slices?: boolean;
    metadata_content?: boolean;
    metadata_content_format?: "html" | "markdown";
};

export type ScreenshotContent = {
    url: string;
    expires: string;
    format?: "html" | "markdown";
};

export type ScreenshotSlice = {
    index: number;
    offset_y: number;
    width: number;
    height: number;
    url: string;
};

export type ScreenshotResult = {
    url: string;
    content?: ScreenshotContent;
    slices?: ScreenshotSlice[];
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
        full_page_slices = false,
        metadata_content = false,
        metadata_content_format,
    }: ScreenshotOptions,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL
): string {
    const screenshotUrl = new URL("/take", apiBaseUrl);
    screenshotUrl.searchParams.set("url", url);
    screenshotUrl.searchParams.set("response_type", "json");
    screenshotUrl.searchParams.set("cache", "false");
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
    screenshotUrl.searchParams.set(
        "full_page_slices",
        full_page_slices.toString()
    );
    screenshotUrl.searchParams.set(
        "metadata_content",
        metadata_content.toString()
    );
    if (metadata_content_format) {
        screenshotUrl.searchParams.set(
            "metadata_content_format",
            metadata_content_format
        );
    }

    return screenshotUrl.toString();
}

export function buildMarkdownUrl(
    url: string,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL
): string {
    const markdownUrl = new URL("/take", apiBaseUrl);
    markdownUrl.searchParams.set("url", url);
    markdownUrl.searchParams.set("format", "markdown");
    markdownUrl.searchParams.set("response_type", "by_format");
    return markdownUrl.toString();
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
                error: `ScreenshotOne API response exceeds ${MAX_API_RESPONSE_BYTES} bytes.`,
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

export async function extractWebsiteMarkdown(
    url: string,
    apiKey: string,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL,
    fetchFn: typeof fetch = fetch
) {
    return makeApiRequest(buildMarkdownUrl(url, apiBaseUrl), apiKey, fetchFn);
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

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isHttpUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;

    try {
        return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function invalidScreenshotResponse(): Error {
    return new Error("ScreenshotOne returned an invalid screenshot response.");
}

export function parseScreenshotResult(body: ArrayBuffer): ScreenshotResult {
    let value: unknown;
    try {
        value = JSON.parse(decodeText(body));
    } catch {
        throw new Error("ScreenshotOne returned an invalid JSON response.");
    }

    if (!isObject(value) || !isHttpUrl(value.screenshot_url)) {
        throw new Error(
            "ScreenshotOne response did not include a valid screenshot URL."
        );
    }

    const result: ScreenshotResult = { url: value.screenshot_url };

    if (value.content !== undefined) {
        if (
            !isObject(value.content) ||
            !isHttpUrl(value.content.url) ||
            typeof value.content.expires !== "string" ||
            (value.content.format !== undefined &&
                value.content.format !== "html" &&
                value.content.format !== "markdown")
        ) {
            throw invalidScreenshotResponse();
        }

        result.content = {
            url: value.content.url,
            expires: value.content.expires,
        };
        if (value.content.format) {
            result.content.format = value.content.format;
        }
    }

    if (value.slices !== undefined) {
        if (!Array.isArray(value.slices)) {
            throw invalidScreenshotResponse();
        }

        result.slices = value.slices.map((slice) => {
            if (
                !isObject(slice) ||
                !isNonNegativeInteger(slice.index) ||
                !isNonNegativeInteger(slice.offset_y) ||
                !isPositiveInteger(slice.width) ||
                !isPositiveInteger(slice.height) ||
                !isHttpUrl(slice.url)
            ) {
                throw invalidScreenshotResponse();
            }

            return {
                index: slice.index,
                offset_y: slice.offset_y,
                width: slice.width,
                height: slice.height,
                url: slice.url,
            };
        });
    }

    return result;
}
