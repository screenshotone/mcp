import assert from "node:assert/strict";
import test from "node:test";

import {
    buildScreenshotUrl,
    getUsage,
    MAX_API_RESPONSE_BYTES,
    makeScreenshotOneRequest,
} from "../build/index.js";

const apiKey = process.env.SCREENSHOTONE_API_KEY ?? "test_access_key";

test("builds ScreenshotOne URL without the access key in query string", () => {
    const screenshotUrl = buildScreenshotUrl({
        url: "https://example.com",
        block_banners: true,
        block_ads: true,
        image_quality: 80,
        full_page: false,
        response_type: "by_format",
        cache: true,
        cache_key: "abc123",
    });

    const parsedUrl = new URL(screenshotUrl);

    assert.equal(parsedUrl.origin, "https://api.screenshotone.com");
    assert.equal(parsedUrl.pathname, "/take");
    assert.equal(parsedUrl.searchParams.get("url"), "https://example.com");
    assert.equal(parsedUrl.searchParams.get("access_key"), null);
    assert.equal(screenshotUrl.includes(apiKey), false);
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
