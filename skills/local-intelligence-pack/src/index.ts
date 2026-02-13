import { searchPlacesOpenNow } from './tools/search_places';
import { readFileContent } from './tools/file_system';
import { clearOpenAISettings } from './tools/config_management';
import { startFileOpenerServer } from './file_opener_server';

// Start the Express server for opening files/folders.
// This should be done once when the skill pack is loaded by OpenClaw.
startFileOpenerServer();

// Define the tools that OpenClaw will use.
// The exact structure and export mechanism might vary slightly based on OpenClaw's API.
export const tools = [
    {
        name: "search_places_open_now",
        description: "Searches for places of a certain category near a given location that are open now. Requires AWS Location Service configuration.",
        parameters: {
            type: "object",
            properties: {
                latitude: { type: "number", description: "The latitude of the search center." },
                longitude: { type: "number", description: "The longitude of the search center." },
                category: { type: "string", description: "The category of place to search for (e.g., 'coffee shop', 'restaurant')." },
            },
            required: ["latitude", "longitude", "category"],
        },
        execute: searchPlacesOpenNow,
    },
    {
        name: "read_file",
        description: "Reads the content of a file at a given absolute path.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "The absolute path to the file." },
            },
            required: ["path"],
        },
        execute: readFileContent,
    },
    {
        name: "open_file_location",
        description: "Opens a specific file or the folder containing a file in the system's default file explorer. This tool communicates with a local Express server.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "The absolute path to the file or folder to open." },
            },
            required: ["path"],
        },
        // The execute function for open_file_location will make an HTTP call to the local server
        execute: async (path: string) => {
            const port = process.env.OPEN_FILE_LOCATION_PORT ? parseInt(process.env.OPEN_FILE_LOCATION_PORT) : 3001;
            try {
                const response = await fetch(`http://localhost:${port}/open?path=${encodeURIComponent(path)}`);
                const data = await response.json();
                if (response.ok) {
                    return `Successfully requested to open: ${path}. Server message: ${data.message}`;
                } else {
                    throw new Error(`Server responded with error: ${data.message || response.statusText}`);
                }
            } catch (error: any) {
                console.error(`Error calling file opener server for ${path}:`, error);
                throw new Error(`Could not reach file opener server or server error: ${error.message}`);
            }
        },
    },
    {
        name: "clear_openai_settings",
        description: "Clears the cached settings for the OpenAI provider. (Placeholder implementation)",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: clearOpenAISettings,
    },
];

console.log("OpenClaw Local Intelligence Pack loaded and tools registered.");
