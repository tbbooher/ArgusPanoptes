import { LocationClient, SearchPlaceIndexForTextCommand } from "@aws-sdk/client-location";

/**
 * Searches for places of a certain category near a given location that are open now.
 *
 * @param latitude The latitude of the search center.
 * @param longitude The longitude of the search center.
 * @param category The category of place to search for (e.g., "coffee shop", "restaurant").
 * @returns A JSON object containing a list of places.
 */
export async function searchPlacesOpenNow(latitude: number, longitude: number, category: string): Promise<any> {
    // IMPORTANT: Configure your AWS region and Place Index Name.
    // AWS credentials must be configured in the environment where OpenClaw runs
    // (e.g., via environment variables AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION).
    const region = process.env.AWS_REGION || "us-east-1"; // Replace with your desired region
    const placeIndexName = process.env.AWS_PLACE_INDEX_NAME || "ExamplePlaceIndex"; // Replace with your Place Index Name

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        console.warn("AWS credentials not found. Place search will likely fail.");
    }

    const client = new LocationClient({ region: region });

    const command = new SearchPlaceIndexForTextCommand({
        IndexName: placeIndexName,
        Text: category,
        BiasPosition: [longitude, latitude],
        // FilterCategories: [category], // Optional: further filter by category if needed
        // Note: AWS Location Service doesn't directly support "open now" filtering.
        // This functionality would require integrating with another service (e.g., Yelp, Google Places API)
        // or performing custom logic based on business hours if available in the place data.
    });

    try {
        const response = await client.send(command);
        return response.Results?.map(result => ({
            name: result.Place?.Label,
            address: result.Place?.Address?.Label,
            country: result.Place?.Country,
            municipality: result.Place?.Municipality,
            // Add more place details as needed
        }));
    } catch (error) {
        console.error("Error searching places:", error);
        throw error;
    }
}
