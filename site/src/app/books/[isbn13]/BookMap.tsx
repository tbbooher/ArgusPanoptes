"use client";

import dynamic from "next/dynamic";

const MiniMap = dynamic(() => import("@/components/map/MiniMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[300px] items-center justify-center rounded-lg bg-gray-800 text-gray-500">
      Loading map...
    </div>
  ),
});

interface BookMapProps {
  markers: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    city: string | null;
    copies: number;
  }[];
}

export function BookMap({ markers }: BookMapProps) {
  return <MiniMap markers={markers} height={300} />;
}
