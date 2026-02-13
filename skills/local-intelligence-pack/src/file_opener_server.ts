import express from 'express';
import { exec } from 'child_process';
import path from 'path';
import * as os from 'os';

const app = express();
// The port for the file opener server. It can be configured via an environment variable.
// It's crucial this port is unique and not blocked by other applications.
const port = process.env.OPEN_FILE_LOCATION_PORT ? parseInt(process.env.OPEN_FILE_LOCATION_PORT) : 3001;

// IMPORTANT SECURITY CONSIDERATION:
// This endpoint allows opening files/folders on the local system.
// You MUST implement robust security measures to prevent malicious usage,
// such as restricting paths to allowed directories (e.g., user's home, downloads).
// The current implementation includes a basic check but might need to be strengthened.
app.get('/open', (req, res) => {
    const filePath = req.query.path as string;

    if (!filePath) {
        return res.status(400).json({ status: 'error', message: 'Path is required' });
    }

    const absolutePath = path.resolve(filePath);

    // Basic security check: ensure path is within an allowed directory (e.g., user's home directory)
    // You might want to expand this to a whitelist of directories or more granular checks.
    const allowedBaseDir = os.homedir(); // Restrict to user's home directory for safety
    if (!absolutePath.startsWith(allowedBaseDir) && !absolutePath.startsWith(path.join(os.homedir(), 'Downloads'))) {
        // Example: also allow Downloads folder
        console.warn(`Attempt to open path outside allowed directories: ${absolutePath}`);
        return res.status(403).json({ status: 'error', message: 'Access denied to this path. Path must be within home or downloads directory.' });
    }

    let command: string;
    let targetPath = absolutePath;

    // Determine the command based on the operating system
    if (os.platform() === 'win32') {
        command = `explorer "${targetPath}"`;
    } else if (os.platform() === 'darwin') {
        command = `open "${targetPath}"`;
    } else {
        // For Linux, typically xdg-open works for both files and directories
        command = `xdg-open "${targetPath}"`;
    }

    console.log(`Executing command to open: ${command}`);
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ status: 'error', message: `Failed to open ${targetPath}: ${error.message}`, details: stderr });
        }
        res.json({ status: 'success', message: `Successfully requested to open ${targetPath}.` });
    });
});

/**
 * Starts the Express server for opening files/folders.
 * This server runs in the background and listens for requests from OpenClaw.
 */
export function startFileOpenerServer() {
    // Ensure the server starts only once
    if (!app.listening) {
        app.listen(port, () => {
            console.log(`File opener server listening on http://localhost:${port}`);
        });
    } else {
        console.log(`File opener server already running on http://localhost:${port}`);
    }
}
