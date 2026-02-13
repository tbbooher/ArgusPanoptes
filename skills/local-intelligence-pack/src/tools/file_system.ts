import * as fs from 'fs/promises';

/**
 * Reads the content of a file at a given path.
 *
 * @param path The absolute path to the file.
 * @returns A string containing the content of the file.
 */
export async function readFileContent(path: string): Promise<string> {
    try {
        const content = await fs.readFile(path, { encoding: 'utf8' });
        return content;
    } catch (error) {
        console.error(`Error reading file ${path}:`, error);
        throw error;
    }
}
