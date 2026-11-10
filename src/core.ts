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

export type UsageResult = {
    total: number;
    available: number;
    used: number;
    concurrency: {
        limit: number;
        remaining: number;
        reset: number;
    };
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
    fetchFn: typeof fetch = fetch,
    jsonBody?: Record<string, unknown>
): Promise<ApiResponse> {
    try {
        const response = await fetchFn(
            url,
            jsonBody === undefined
                ? {
                      headers: { "X-Access-Key": apiKey },
                      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
                  }
                : {
                      method: "POST",
                      headers: {
                          "X-Access-Key": apiKey,
                          "Content-Type": "application/json",
                      },
                      body: JSON.stringify(jsonBody),
                      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
                  }
        );
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

function isNonNegativeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

export function parseUsageResult(body: ArrayBuffer): UsageResult {
    let value: unknown;
    try {
        value = JSON.parse(decodeText(body));
    } catch {
        throw new Error("ScreenshotOne returned an invalid JSON response.");
    }

    if (
        !isObject(value) ||
        !isNonNegativeInteger(value.total) ||
        !isNonNegativeInteger(value.available) ||
        !isNonNegativeInteger(value.used) ||
        !isObject(value.concurrency) ||
        !isNonNegativeInteger(value.concurrency.limit) ||
        !isNonNegativeInteger(value.concurrency.remaining) ||
        !isNonNegativeNumber(value.concurrency.reset)
    ) {
        throw new Error("ScreenshotOne returned an invalid usage response.");
    }

    return {
        total: value.total,
        available: value.available,
        used: value.used,
        concurrency: {
            limit: value.concurrency.limit,
            remaining: value.concurrency.remaining,
            reset: value.concurrency.reset,
        },
    };
}

export const SCREENSHOT_FILE_FORMATS = [
    "jpg",
    "png",
    "webp",
    "gif",
    "jp2",
    "tiff",
    "avif",
    "heif",
    "pdf",
] as const;

export type ScreenshotFileFormat = (typeof SCREENSHOT_FILE_FORMATS)[number];

const SCREENSHOT_FILE_MIME_TYPES: Record<ScreenshotFileFormat, string> = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    jp2: "image/jp2",
    tiff: "image/tiff",
    avif: "image/avif",
    heif: "image/heif",
    pdf: "application/pdf",
};

/** Files are base64-encoded into the tool result, which adds about a third. */
export const MAX_SCREENSHOT_FILE_BYTES = 5 * 1024 * 1024;

export type ScreenshotFileOptions = {
    url: string;
    format: ScreenshotFileFormat;
    block_banners: boolean;
    block_ads: boolean;
    image_quality: number;
    full_page: boolean;
    full_page_max_height?: number;
};

export type ScreenshotFile = {
    name: string;
    uri: string;
    mime_type: string;
    size: number;
    url: string;
};

export type ScreenshotFileResponse =
    | { ok: true; file: ScreenshotFile; blob: string }
    | { ok: false; error: string };

export function buildScreenshotFileUrl(
    {
        url,
        format,
        block_banners,
        block_ads,
        image_quality,
        full_page,
        full_page_max_height,
    }: ScreenshotFileOptions,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL
): string {
    const screenshotUrl = new URL("/take", apiBaseUrl);
    screenshotUrl.searchParams.set("url", url);
    screenshotUrl.searchParams.set("response_type", "json");
    screenshotUrl.searchParams.set("cache", "false");
    screenshotUrl.searchParams.set("format", format);
    // The API rejects image_quality for PDF and GIF.
    if (format !== "pdf" && format !== "gif") {
        screenshotUrl.searchParams.set(
            "image_quality",
            image_quality.toString()
        );
    }
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
    if (full_page_max_height !== undefined) {
        screenshotUrl.searchParams.set(
            "full_page_max_height",
            full_page_max_height.toString()
        );
    }
    if (format === "pdf") {
        screenshotUrl.searchParams.set("pdf_print_background", "true");
    }

    return screenshotUrl.toString();
}

export function screenshotFileName(
    url: string,
    format: ScreenshotFileFormat,
    now = new Date()
): string {
    let host = "screenshot";
    try {
        host =
            new URL(url).hostname
                .replace(/^www\./, "")
                .replace(/[^a-z0-9.-]/gi, "-") || host;
    } catch {}
    return `${host}-${fileTimestamp(now)}.${format}`;
}

function fileTimestamp(now: Date): string {
    return now
        .toISOString()
        .slice(0, 19)
        .replace("T", "-")
        .replaceAll(":", "");
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + 0x8000)
        );
    }
    return btoa(binary);
}

export async function takeScreenshotFile(
    options: ScreenshotFileOptions,
    apiKey: string,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL,
    fetchFn: typeof fetch = fetch
): Promise<ScreenshotFileResponse> {
    const response = await makeApiRequest(
        buildScreenshotFileUrl(options, apiBaseUrl),
        apiKey,
        fetchFn
    );
    if (!response.ok) {
        return { ok: false, error: response.error };
    }

    let screenshotUrl: string;
    try {
        screenshotUrl = parseScreenshotResult(response.body).url;
    } catch (error) {
        return {
            ok: false,
            error:
                error instanceof Error
                    ? error.message
                    : "ScreenshotOne returned an invalid response.",
        };
    }

    let body: ArrayBuffer;
    try {
        const file = await fetchFn(screenshotUrl, {
            signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
        });
        if (!file.ok) {
            await file.body?.cancel();
            return {
                ok: false,
                error: `Downloading the rendered file failed with status ${file.status}.`,
            };
        }
        body = await readBoundedBody(file, MAX_SCREENSHOT_FILE_BYTES);
    } catch (error) {
        if (error instanceof ResponseTooLargeError) {
            return {
                ok: false,
                error:
                    `The rendered file is larger than ${MAX_SCREENSHOT_FILE_BYTES / 1024 / 1024} MB, the limit for files returned in the result. ` +
                    "Try format=jpg with a lower image_quality, format=pdf, full_page_max_height to limit the height of a full-page screenshot, or full_page=false. " +
                    `The file is also available for a few hours at ${screenshotUrl}`,
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            error: `Downloading the rendered file failed: ${message}`,
        };
    }

    const name = screenshotFileName(options.url, options.format);
    return {
        ok: true,
        file: {
            name,
            uri: `screenshotone://screenshots/${name}`,
            mime_type: SCREENSHOT_FILE_MIME_TYPES[options.format],
            size: body.byteLength,
            url: screenshotUrl,
        },
        blob: toBase64(new Uint8Array(body)),
    };
}

/** HTML passed inline by an AI agent; larger documents should be hosted and rendered by URL. */
export const MAX_HTML_CHARACTERS = 1_000_000;

export type HtmlScreenshotOptions = {
    html: string;
    viewport_width: number;
    full_page: boolean;
    image_quality: number;
};

export type HtmlScreenshotFile = {
    name: string;
    mime_type: string;
    size: number;
};

export type HtmlScreenshotFileResponse =
    | { ok: true; file: HtmlScreenshotFile; data: string }
    | { ok: false; error: string };

export function buildHtmlScreenshotRequestBody({
    html,
    viewport_width,
    full_page,
    image_quality,
}: HtmlScreenshotOptions): Record<string, unknown> {
    return {
        html,
        viewport_width,
        full_page,
        format: "jpg",
        image_quality,
        response_type: "by_format",
        cache: false,
    };
}

export async function takeHtmlScreenshotFile(
    options: HtmlScreenshotOptions,
    apiKey: string,
    apiBaseUrl = SCREENSHOTONE_API_BASE_URL,
    fetchFn: typeof fetch = fetch
): Promise<HtmlScreenshotFileResponse> {
    const response = await makeApiRequest(
        new URL("/take", apiBaseUrl).toString(),
        apiKey,
        fetchFn,
        buildHtmlScreenshotRequestBody(options)
    );
    if (!response.ok) {
        return { ok: false, error: response.error };
    }
    if (response.contentType.split(";")[0].trim() !== "image/jpeg") {
        return {
            ok: false,
            error: "ScreenshotOne returned an unexpected response instead of a JPEG image.",
        };
    }
    if (response.body.byteLength > MAX_SCREENSHOT_FILE_BYTES) {
        return {
            ok: false,
            error:
                `The rendered image is larger than ${MAX_SCREENSHOT_FILE_BYTES / 1024 / 1024} MB, the limit for images returned in the result. ` +
                "Try a lower image_quality or full_page=false.",
        };
    }

    return {
        ok: true,
        file: {
            name: `html-${fileTimestamp(new Date())}.jpg`,
            mime_type: "image/jpeg",
            size: response.body.byteLength,
        },
        data: toBase64(new Uint8Array(response.body)),
    };
}
