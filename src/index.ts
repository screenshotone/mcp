import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const SCREENSHOTONE_BASE_URL = "https://api.screenshotone.com";

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

function getApiKey(): string {
    const apiKey = process.env.SCREENSHOTONE_API_KEY;
    if (!apiKey) {
        throw new Error("SCREENSHOTONE_API_KEY is required");
    }

    return apiKey;
}

const server = new McpServer({
    name: "screenshotone",
    description:
        "Render website screenshots of any website and get them as images.",
    version: "1.0.0",
});

export function buildScreenshotUrl({
    url,
    block_banners,
    block_ads,
    image_quality,
    full_page,
    response_type,
    cache,
    cache_key,
}: ScreenshotOptions): string {
    const screenshotUrl = new URL("/take", SCREENSHOTONE_BASE_URL);
    screenshotUrl.searchParams.set("url", url);
    screenshotUrl.searchParams.set("response_type", response_type);
    screenshotUrl.searchParams.set("cache", cache.toString());
    screenshotUrl.searchParams.set("format", "jpeg");
    screenshotUrl.searchParams.set("image_quality", image_quality.toString());
    screenshotUrl.searchParams.set("block_cookie_banners", block_banners.toString());
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

export async function makeScreenshotOneRequest<T>(
    url: string,
    apiKey: string,
    fetchFn: typeof fetch = fetch
): Promise<T | { error: string }> {
    try {
        const response = await fetchFn(url, {
            headers: {
                "X-Access-Key": apiKey,
            },
        });
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
        const screenshotUrl = buildScreenshotUrl({
            url,
            block_banners,
            block_ads,
            image_quality,
            full_page,
            response_type,
            cache,
            cache_key,
        });

        const screenshot = await makeScreenshotOneRequest<ArrayBuffer>(
            screenshotUrl,
            getApiKey()
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error("Fatal error in main():", error);
        process.exit(1);
    });
}
