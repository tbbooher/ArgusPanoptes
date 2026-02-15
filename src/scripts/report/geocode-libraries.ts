#!/usr/bin/env tsx
/**
 * Step 2: Geocode library systems by mapping branch cities to coordinates.
 *
 * Reads YAML configs via loadLibraryRegistry(), looks up each system's
 * first-branch city in tx_city_coords.json, and merges with holdings
 * counts from Step 1 output. Writes geocoded_libraries.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibraryRegistry } from "../../config/library-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const OUTPUT_DIR = join(__dirname, "output", "data");

interface CityCoords {
  [city: string]: [number, number]; // [lat, lng]
}

interface SystemStats {
  systemId: string;
  systemName: string;
  booksHeld: number;
  totalCopies: number;
  totalAvailable: number;
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load city coordinates
  const coordsPath = join(__dirname, "tx_city_coords.json");
  const coords: CityCoords = JSON.parse(readFileSync(coordsPath, "utf-8"));

  // Load holdings stats from Step 1
  const topSystemsPath = join(OUTPUT_DIR, "top_systems.json");
  const topSystems: SystemStats[] = JSON.parse(
    readFileSync(topSystemsPath, "utf-8"),
  );
  const statsMap = new Map(topSystems.map((s) => [s.systemId, s]));

  // Load library configs
  const configDir = join(PROJECT_ROOT, "src", "config", "libraries");
  const systems = loadLibraryRegistry(configDir);

  const geocoded: {
    id: string;
    name: string;
    city: string | null;
    region: string;
    vendor: string;
    enabled: boolean;
    lat: number | null;
    lng: number | null;
    booksHeld: number;
    totalCopies: number;
    totalAvailable: number;
  }[] = [];

  let matched = 0;
  let unmatched = 0;

  for (const sys of systems) {
    const city = sys.branches[0]?.city ?? null;
    const coordPair = city ? coords[city] ?? null : null;

    const stats = statsMap.get(sys.id);

    geocoded.push({
      id: sys.id,
      name: sys.name,
      city,
      region: sys.region,
      vendor: sys.vendor,
      enabled: sys.enabled,
      lat: coordPair ? coordPair[0] : null,
      lng: coordPair ? coordPair[1] : null,
      booksHeld: stats?.booksHeld ?? 0,
      totalCopies: stats?.totalCopies ?? 0,
      totalAvailable: stats?.totalAvailable ?? 0,
    });

    if (coordPair) {
      matched++;
    } else if (city) {
      unmatched++;
      console.warn(`  No coordinates for city: "${city}" (${sys.id})`);
    }
  }

  const outputPath = join(OUTPUT_DIR, "geocoded_libraries.json");
  writeFileSync(outputPath, JSON.stringify(geocoded, null, 2));

  console.log(
    `Geocoded ${matched}/${systems.length} systems ` +
      `(${unmatched} cities not in lookup)`,
  );
}

main();
