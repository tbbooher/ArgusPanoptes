"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import type { MapMarker } from "@/lib/types";

const TX_CENTER: [number, number] = [31.0, -99.9];
const TX_ZOOM = 6;

function getMarkerColor(booksHeld: number): string {
  if (booksHeld === 0) return "#6b7280"; // gray
  if (booksHeld < 10) return "#fbbf24"; // yellow
  if (booksHeld < 50) return "#f97316"; // orange
  return "#ef4444"; // red
}

function createIcon(booksHeld: number) {
  const color = getMarkerColor(booksHeld);
  return L.divIcon({
    html: `<div style="background-color:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

interface FullMapProps {
  markers: MapMarker[];
}

export default function FullMap({ markers }: FullMapProps) {
  return (
    <MapContainer
      center={TX_CENTER}
      zoom={TX_ZOOM}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MarkerClusterGroup chunkedLoading>
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={createIcon(m.booksHeld)}
          >
            <Popup>
              <div className="text-sm min-w-[180px]">
                <p className="font-semibold text-base">{m.name}</p>
                {m.city && (
                  <p className="text-gray-500">
                    {m.city}, {m.region}
                  </p>
                )}
                <p className="mt-1">
                  <strong>{m.booksHeld}</strong> books held &middot;{" "}
                  <strong>{m.totalCopies}</strong> copies
                </p>
                <p className="text-gray-500 text-xs mt-1">{m.vendor}</p>
                <Link
                  href={`/libraries/${m.id}`}
                  className="mt-2 inline-block text-blue-500 hover:text-blue-400 text-xs"
                >
                  View details &rarr;
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
