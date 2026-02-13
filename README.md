# OpenClaw Skill: Local Intelligence Pack

This document provides the specification for a skill pack for the OpenClaw AI assistant. This skill pack, tentatively named "Local Intelligence Pack," provides the assistant with capabilities to interact with the local environment, including searching for nearby places and accessing the local file system.

## 1. Features

This skill pack will provide the following tools to the OpenClaw assistant:

*   **Nearby Place Search:** Enables the assistant to find nearby points of interest that are currently open. This is useful for queries like "Find a coffee shop near me that's open now."
*   **Local File System Browser:** Allows the assistant to browse, read, and open files on the local system. This is for commands like "Open my downloads folder" or "Show me the contents of `config.txt`".
*   **AI Configuration Management:** A utility to manage AI provider settings, such as clearing cached credentials.

## 2. Architecture and Implementation

This skill pack is designed to be integrated into an OpenClaw instance. While OpenClaw is a Node.js application, the provided reference implementations are a mix of Python and JavaScript.

For a robust and maintainable implementation, all functionalities should be ported to a single language, preferably **TypeScript or JavaScript**, to align with OpenClaw's native environment.

### 2.1. Dependencies

*   **Nearby Place Search:** This feature depends on Amazon Web Services (AWS).
    *   `@aws-sdk/client-location`: The AWS SDK for JavaScript to interact with Amazon Location Service.
*   **Local File System Browser:**
    *   `fs`: The built-in Node.js file system module for reading files.
    *   `child_process`: To open file locations in the system's file explorer.
*   **Web Server (for file opening):**
    *   `express`: A web framework to expose an endpoint for opening files. This is required to bridge from a web-based assistant interface to the local file system.

## 3. Tool Specification

The following tools will be exposed to the OpenClaw assistant.

### Tool 1: `search_places_open_now`

*   **Description:** Searches for places of a certain category near a given location that are open now. Use this when the user asks for nearby places, like restaurants, cafes, or stores.
*   **Input Parameters:**
    *   `latitude`: (number, required) The latitude of the search center.
    *   `longitude`: (number, required) The longitude of the search center.
    *   `category`: (string, required) The category of place to search for (e.g., "coffee shop", "restaurant").
*   **Output:** A JSON object containing a list of places, each with its name, address, and other relevant details.
*   **Implementation Notes:** This tool will use the Amazon Location Service. It requires AWS credentials with permissions for `geo:SearchPlaceIndexForText`.

### Tool 2: `read_file`

*   **Description:** Reads the content of a file at a given path.
*   **Input Parameters:**
    *   `path`: (string, required) The absolute path to the file.
*   **Output:** A string containing the content of the file.
*   **Implementation Notes:** This tool will use the `fs.readFile` method from Node.js's `fs` module.

### Tool 3: `open_file_location`

*   **Description:** Opens the folder containing a given file or opens a folder path in the system's file explorer.
*   **Input Parameters:**
    *   `path`: (string, required) The absolute path to the file or folder.
*   **Output:** A success or failure message.
*   **Implementation Notes:** This will be implemented via a web server endpoint (e.g., using Express). A GET request to an endpoint like `/open?path=<path>` will trigger a `child_process` command (e.g., `explorer.exe` on Windows, `open` on macOS, `xdg-open` on Linux).

### Tool 4: `clear_openai_settings`

*   **Description:** Clears the cached settings for the OpenAI provider.
*   **Input Parameters:** None.
*   **Output:** A confirmation message.

## 4. Proposed File Structure

```
.
├── README.md
├── package.json
└── src
    ├── tools
    │   ├── search_places.ts
    │   ├── file_system.ts
    │   └── config_management.ts
    └── index.ts  // Main entry point, registers the tools with OpenClaw
```

## 5. Deployment on OpenClaw

1.  **Prerequisites:** An existing OpenClaw installation.
2.  **Dependencies:**
    *   Install the required npm packages: `npm install @aws-sdk/client-location express`
    *   Configure AWS credentials in your environment. You will need an AWS Access Key ID and Secret Access Key with permissions for Amazon Location Service.
3.  **Integration:**
    *   The `index.ts` file will be the main entry point for the skill. It should export a function that OpenClaw can use to register the tools. (The exact mechanism for this will depend on OpenClaw's plugin architecture).
    *   Each tool will be defined in its own file under `src/tools/`.
4.  **Running the File Opener Service:**
    *   The Express server for `open_file_location` will need to be started as a background process.

This specification provides a blueprint for building the "Local Intelligence Pack." The next step is to implement the tools in TypeScript and integrate them into your OpenClaw instance.
