import assert from "node:assert/strict";
import test from "node:test";

import {
    buildMarkdownUrl,
    buildScreenshotUrl,
    getUsage,
    MAX_API_RESPONSE_BYTES,
    makeScreenshotOneRequest,
    parseScreenshotResult,
} from "../build/index.js";

const apiKey = process.env.SCREENSHOTONE_API_KEY ?? "test_access_key";

test("builds ScreenshotOne URL without the access key in query string", () => {
    const screenshotUrl = buildScreenshotUrl({
        url: "https://example.com",
        block_banners: true,
        block_ads: true,
        image_quality: 80,
        full_page: true,
        full_page_slices: true,
        metadata_content: true,
        metadata_content_format: "markdown",
    });

    const parsedUrl = new URL(screenshotUrl);

    assert.equal(parsedUrl.origin, "https://api.screenshotone.com");
    assert.equal(parsedUrl.pathname, "/take");
    assert.equal(parsedUrl.searchParams.get("url"), "https://example.com");
    assert.equal(parsedUrl.searchParams.get("response_type"), "json");
    assert.equal(parsedUrl.searchParams.get("cache"), "false");
    assert.equal(parsedUrl.searchParams.get("cache_key"), null);
    assert.equal(parsedUrl.searchParams.get("full_page"), "true");
    assert.equal(parsedUrl.searchParams.get("full_page_slices"), "true");
    assert.equal(parsedUrl.searchParams.get("metadata_content"), "true");
    assert.equal(
        parsedUrl.searchParams.get("metadata_content_format"),
        "markdown"
    );
    assert.equal(parsedUrl.searchParams.get("access_key"), null);
    assert.equal(screenshotUrl.includes(apiKey), false);
});

test("builds the Markdown shortcut URL with no user-facing options", () => {
    const markdownUrl = new URL(buildMarkdownUrl("https://example.com"));

    assert.equal(markdownUrl.pathname, "/take");
    assert.deepEqual([...markdownUrl.searchParams.keys()].sort(), [
        "format",
        "response_type",
        "url",
    ]);
    assert.equal(markdownUrl.searchParams.get("url"), "https://example.com");
    assert.equal(markdownUrl.searchParams.get("format"), "markdown");
    assert.equal(markdownUrl.searchParams.get("response_type"), "by_format");
});

test("extracts screenshot, content, and slice URLs from an API response", () => {
    const result = parseScreenshotResult(
        new TextEncoder().encode(
            JSON.stringify({
                screenshot_url: "https://cache.screenshotone.com/example.jpg",
                cache_url: "https://cache.screenshotone.com/cached.jpg",
                content: {
                    url: "https://cache.screenshotone.com/example.md",
                    expires: "Sun, 07 Sep 2026 12:00:00 GMT",
                    format: "markdown",
                },
                slices: [
                    {
                        index: 0,
                        offset_y: 0,
                        width: 1280,
                        height: 4000,
                        url: "https://cache.screenshotone.com/slice-0.jpg",
                    },
                ],
                metadata: { image_size: { width: 1280, height: 720 } },
            })
        ).buffer
    );

    assert.deepEqual(result, {
        url: "https://cache.screenshotone.com/example.jpg",
        content: {
            url: "https://cache.screenshotone.com/example.md",
            expires: "Sun, 07 Sep 2026 12:00:00 GMT",
            format: "markdown",
        },
        slices: [
            {
                index: 0,
                offset_y: 0,
                width: 1280,
                height: 4000,
                url: "https://cache.screenshotone.com/slice-0.jpg",
            },
        ],
    });
});

test("rejects an API response without a valid screenshot URL", () => {
    assert.throws(
        () =>
            parseScreenshotResult(
                new TextEncoder().encode(
                    JSON.stringify({ screenshot_url: "javascript:alert(1)" })
                ).buffer
            ),
        /valid screenshot URL/
    );
});

test("sends the API key with X-Access-Key header", async () => {
    let capturedUrl;
    let capturedHeaders;

    const response = await makeScreenshotOneRequest(
        "https://api.screenshotone.com/take?url=https%3A%2F%2Fexample.com",
        apiKey,
        async (url, init) => {
            capturedUrl = url;
            capturedHeaders = new Headers(init?.headers);

            return new Response(new Uint8Array([1, 2, 3]));
        }
    );

    assert.equal(capturedUrl.includes("access_key"), false);
    assert.equal(capturedHeaders.get("X-Access-Key"), apiKey);
    assert.ok(response instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(response)], [1, 2, 3]);
});

test("gets usage with the API key header and no query credential", async () => {
    let capturedUrl;
    let capturedHeaders;

    const response = await getUsage(
        apiKey,
        "https://api.screenshotone.com",
        async (url, init) => {
            capturedUrl = url;
            capturedHeaders = new Headers(init?.headers);
            return Response.json({ total: 100, used: 1, available: 99 });
        }
    );

    assert.equal(capturedUrl, "https://api.screenshotone.com/usage");
    assert.equal(capturedUrl.includes(apiKey), false);
    assert.equal(capturedHeaders.get("X-Access-Key"), apiKey);
    assert.equal(response.ok, true);
});

test("rejects oversized API responses without buffering them", async () => {
    const response = await getUsage(
        apiKey,
        "https://api.screenshotone.com",
        async () =>
            new Response(new Uint8Array([1]), {
                headers: {
                    "Content-Length": String(MAX_API_RESPONSE_BYTES + 1),
                },
            })
    );

    assert.equal(response.ok, false);
    assert.match(response.error, /exceeds/);
});
