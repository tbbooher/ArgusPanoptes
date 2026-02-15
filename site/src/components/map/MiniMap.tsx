"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icon
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface MiniMapProps {
  markers: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    city?: string | null;
    copies?: number;
  }[];
  height?: number;
}

const TX_CENTER: [number, number] = [31.0, -99.9];

export default function MiniMap({ markers, height = 300 }: MiniMapProps) {
  // Compute bounds or use TX center
  const bounds =
    markers.length > 0
      ? L.latLngBounds(markers.map((m) => [m.lat, m.lng]))
      : undefined;

  return (
    <MapContainer
      bounds={bounds}
      center={markers.length === 0 ? TX_CENTER : undefined}
      zoom={markers.length === 0 ? 6 : undefined}
      boundsOptions={{ padding: [30, 30] }}
      style={{ height, width: "100%", borderRadius: "0.5rem" }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {markers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={defaultIcon}>
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{m.name}</p>
              {m.city && <p className="text-gray-500">{m.city}</p>}
              {m.copies !== undefined && <p>{m.copies} copies</p>}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
