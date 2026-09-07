import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createCliServer } from "../build/index.js";

test("exposes screenshot and Markdown tools with their documented results", async () => {
    const originalApiKey = process.env.SCREENSHOTONE_API_KEY;
    const originalFetch = globalThis.fetch;
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const server = createCliServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    process.env.SCREENSHOTONE_API_KEY = "test_access_key";
    globalThis.fetch = async (input, init) => {
        const requestUrl = new URL(input.toString());
        assert.equal(
            new Headers(init?.headers).get("X-Access-Key"),
            "test_access_key"
        );

        if (requestUrl.searchParams.get("format") === "markdown") {
            assert.deepEqual([...requestUrl.searchParams.keys()].sort(), [
                "format",
                "response_type",
                "url",
            ]);
            assert.equal(
                requestUrl.searchParams.get("response_type"),
                "by_format"
            );
            return new Response("# Example Domain\n\nExtracted content.", {
                headers: { "Content-Type": "text/markdown; charset=utf-8" },
            });
        }

        assert.equal(requestUrl.searchParams.get("response_type"), "json");
        assert.equal(requestUrl.searchParams.get("cache"), "false");
        assert.equal(requestUrl.searchParams.get("cache_key"), null);
        assert.equal(requestUrl.searchParams.get("full_page"), "true");
        assert.equal(requestUrl.searchParams.get("full_page_slices"), "true");
        assert.equal(requestUrl.searchParams.get("metadata_content"), "true");
        assert.equal(
            requestUrl.searchParams.get("metadata_content_format"),
            "markdown"
        );

        return Response.json({
            screenshot_url: "https://cache.screenshotone.com/example.jpg",
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
    };

    try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);

        const tools = await client.listTools();
        const screenshotTool = tools.tools.find(
            ({ name }) => name === "render-website-screenshot"
        );
        assert.ok(screenshotTool);
        assert.deepEqual(screenshotTool.annotations, {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: true,
        });
        assert.deepEqual(
            Object.keys(screenshotTool.inputSchema.properties ?? {}).sort(),
            [
                "block_ads",
                "block_banners",
                "full_page",
                "full_page_slices",
                "image_quality",
                "metadata_content",
                "metadata_content_format",
                "url",
            ]
        );
        assert.deepEqual(
            Object.keys(screenshotTool.outputSchema?.properties ?? {}).sort(),
            ["content", "slices", "url"]
        );

        const markdownTool = tools.tools.find(
            ({ name }) => name === "extract-website-markdown"
        );
        assert.ok(markdownTool);
        assert.deepEqual(markdownTool.annotations, {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: true,
        });
        assert.deepEqual(
            Object.keys(markdownTool.inputSchema.properties ?? {}),
            ["url"]
        );

        const usageTool = tools.tools.find(({ name }) => name === "get-usage");
        assert.ok(usageTool);
        assert.deepEqual(usageTool.annotations, {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: true,
        });

        const invalidSlicesResult = await client.callTool({
            name: "render-website-screenshot",
            arguments: {
                url: "https://example.com",
                full_page_slices: true,
            },
        });
        assert.equal(invalidSlicesResult.isError, true);
        assert.match(
            invalidSlicesResult.content[0].text,
            /full_page_slices requires full_page=true/
        );

        const invalidMetadataResult = await client.callTool({
            name: "render-website-screenshot",
            arguments: {
                url: "https://example.com",
                metadata_content_format: "markdown",
            },
        });
        assert.equal(invalidMetadataResult.isError, true);
        assert.match(
            invalidMetadataResult.content[0].text,
            /metadata_content_format requires metadata_content=true/
        );

        const result = await client.callTool({
            name: "render-website-screenshot",
            arguments: {
                url: "https://example.com",
                full_page: true,
                full_page_slices: true,
                metadata_content: true,
                metadata_content_format: "markdown",
            },
        });
        const expectedScreenshotResult = {
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
        };
        assert.deepEqual(result.structuredContent, expectedScreenshotResult);
        assert.deepEqual(result.content, [
            {
                type: "text",
                text: JSON.stringify(expectedScreenshotResult, null, 2),
            },
        ]);

        const markdownResult = await client.callTool({
            name: "extract-website-markdown",
            arguments: { url: "https://example.com" },
        });
        assert.deepEqual(markdownResult.content, [
            {
                type: "text",
                text: "# Example Domain\n\nExtracted content.",
            },
        ]);
    } finally {
        await client.close();
        await server.close();
        globalThis.fetch = originalFetch;
        if (originalApiKey === undefined) {
            delete process.env.SCREENSHOTONE_API_KEY;
        } else {
            process.env.SCREENSHOTONE_API_KEY = originalApiKey;
        }
    }
});
