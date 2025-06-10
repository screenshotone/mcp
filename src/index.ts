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
    "Render a screenshot of a website and returns it as an image.",
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
    },
    async ({ url, block_banners, block_ads, image_quality, full_page }) => {
        const screenshotUrl = `${SCREENSHOTONE_BASE_URL}/take?url=${encodeURIComponent(
            url
        )}&format=jpeg&image_quality=${image_quality}&access_key=${apiKey}&block_cookie_banners=${block_banners}&block_banners_by_heuristics=${block_banners}&block_ads=${block_ads}&full_page=${full_page}`;
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
