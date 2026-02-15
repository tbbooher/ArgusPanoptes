import { getMapMarkers, getCategories } from "@/lib/data";
import { MapClient } from "./MapClient";

export const metadata = {
  title: "Map - Argus Panoptes",
  description: "Interactive map of Texas library systems",
};

export default function MapPage() {
  const markers = getMapMarkers();
  const categories = getCategories();
  return <MapClient markers={markers} categories={categories} />;
}
