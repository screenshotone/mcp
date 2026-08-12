#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
    arrayBufferToBase64,
    buildScreenshotUrl,
    decodeText,
    getUsage,
    makeScreenshotOneRequest,
    takeScreenshot,
    type ScreenshotOptions,
} from "./core.js";

export {
    buildScreenshotUrl,
    getUsage,
    MAX_API_RESPONSE_BYTES,
    makeScreenshotOneRequest,
    type ScreenshotOptions,
} from "./core.js";

const SCREENSHOT_INPUT = {
    url: z
        .string()
        .url()
        .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
            message: "Only HTTP and HTTPS URLs are supported",
        })
        .describe("URL of the website to screenshot"),
    block_banners: z
        .boolean()
        .default(true)
        .describe("Block cookie, GDPR, and other banners and popups"),
    block_ads: z.boolean().default(true).describe("Block ads"),
    image_quality: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(80)
        .describe("Image quality"),
    full_page: z
        .boolean()
        .default(false)
        .describe("Render the full page screenshot"),
    response_type: z
        .enum(["json", "by_format"])
        .default("by_format")
        .describe("Return the cache JSON or the image itself"),
    cache: z
        .boolean()
        .default(false)
        .describe("Cache the screenshot to get a cache URL"),
    cache_key: z
        .string()
        .max(128)
        .regex(/^[a-zA-Z0-9]+$/)
        .optional()
        .describe("Optional alphanumeric screenshot cache key"),
};

function getApiKey() {
    const apiKey = process.env.SCREENSHOTONE_API_KEY;
    if (!apiKey) throw new Error("SCREENSHOTONE_API_KEY is required");
    return apiKey;
}

export function createCliServer() {
    const server = new McpServer({
        name: "screenshotone",
        description: "Use the ScreenshotOne API from an MCP client.",
        version: "1.1.0",
    });

    server.tool(
        "render-website-screenshot",
        "Renders a screenshot and returns an image or cache response.",
        SCREENSHOT_INPUT,
        async (options) => {
            const response = await takeScreenshot(
                options as ScreenshotOptions,
                getApiKey()
            );
            if (!response.ok) {
                return {
                    isError: true,
                    content: [{ type: "text", text: response.error }],
                };
            }
            if (
                options.response_type === "json" ||
                response.contentType.includes("json")
            ) {
                return {
                    content: [{ type: "text", text: decodeText(response.body) }],
                };
            }
            if (!response.contentType.startsWith("image/")) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: "ScreenshotOne returned an unexpected response type.",
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: "image",
                        mimeType: response.contentType.split(";")[0],
                        data: arrayBufferToBase64(response.body),
                    },
                ],
            };
        }
    );

    server.tool(
        "get-usage",
        "Returns ScreenshotOne API quota and concurrency usage.",
        {},
        async () => {
            const response = await getUsage(getApiKey());
            if (!response.ok) {
                return {
                    isError: true,
                    content: [{ type: "text", text: response.error }],
                };
            }
            return {
                content: [{ type: "text", text: decodeText(response.body) }],
            };
        }
    );

    return server;
}

async function main() {
    const server = createCliServer();
    await server.connect(new StdioServerTransport());
    console.error("ScreenshotOne MCP server running on stdio");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error("Fatal error in main():", error);
        process.exit(1);
    });
}
