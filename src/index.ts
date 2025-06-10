import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SCREENSHOTONE_BASE_URL = "https://api.screenshotone.com";
const apiKey = process.env.SCREENSHOTONE_API_KEY!;

const server = new McpServer({
    name: "screenshotone",
    description:
        "Render website screenshots of any website and get them as images.",
    version: "1.0.0",
});

async function makeScreenshotOneRequest<T>(
    url: string
): Promise<T | { error: string }> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return {
                error: `Failed to render a screenshot status: ${response.status}`,
            };
        }

        return (await response.arrayBuffer()) as T;
    } catch (error) {
        return {
            error: `Failed to render a screenshot: ${error}`,
        };
    }
}

server.tool(
    "render-website-screenshot",
    "Renders a screenshot of a website and returns it as an image or a JSON with the cache URL (preferred for full-page screenshots).",    
    {
        url: z.string().url().describe("URL of the website to screenshot"),
        block_banners: z
            .boolean()
            .default(true)
            .describe("Block cookie, GDPR, and other banners and popups"),
        block_ads: z.boolean().default(true).describe("Block ads"),
        image_quality: z
            .number()
            .min(1)
            .max(100)
            .default(80)
            .describe("Image quality"),
        full_page: z
            .boolean()
            .default(false)
            .describe("Render the full page screenshot of the website"),
        response_type: z
            .enum(["json", "by_format"])
            .default("by_format")
            .describe(
                "Response type: JSON (when the cache URL is needed) or the image itself"
            ),
        cache: z
            .boolean()
            .default(false)
            .describe("Cache the screenshot to get the cache URL"),
        cache_key: z
            .string()
            .regex(/^[a-zA-Z0-9]+$/)
            .optional()
            .describe(
                "Cache key to generate a new cache URL for each screenshot, e.g. timestamp"
            ),
    },
    async ({
        url,
        block_banners,
        block_ads,
        image_quality,
        full_page,
        response_type,
        cache,
        cache_key,
    }) => {
        let screenshotUrl = `${SCREENSHOTONE_BASE_URL}/take?url=${encodeURIComponent(
            url
        )}&response_type=${response_type}&cache=${cache}&format=jpeg&image_quality=${image_quality}&access_key=${apiKey}&block_cookie_banners=${block_banners}&block_banners_by_heuristics=${block_banners}&block_ads=${block_ads}&full_page=${full_page}`;

        if (cache && cache_key) {
            screenshotUrl += `&cache_key=${cache_key}`;
        }

        const screenshot = await makeScreenshotOneRequest<ArrayBuffer>(
            screenshotUrl
        );

        if ("error" in screenshot) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to retrieve screenshot for ${url}: ${screenshot.error}`,
                    },
                ],
            };
        }

        return {
            content: [
                {
                    type: "image",
                    mimeType: "image/jpeg",
                    data: Buffer.from(screenshot).toString("base64"),
                },
            ],
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("ScreenshotOneMCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
