"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import Sidebar from "@/components/Sidebar/Sidebar";

const WalkMap = dynamic(() => import("@/components/Map/WalkMap"), { ssr: false });

export default function Home() {
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string | null>(null);
  const [hoveredNeighborhood, setHoveredNeighborhood] = useState<string | null>(null);
  const [selectedBoroughCodes, setSelectedBoroughCodes] = useState<string[] | null>(null);
  const [suggestedRoute, setSuggestedRoute] = useState<GeoJSON.Feature | null>(null);

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh" }}>
      <WalkMap
        onNeighborhoodClick={(code) => setSelectedNeighborhood(code)}
        hoveredNeighborhood={hoveredNeighborhood}
        selectedNeighborhood={selectedNeighborhood}
        selectedBoroughCodes={selectedBoroughCodes}
        suggestedRoute={suggestedRoute}
      />
      <Sidebar
        selectedNeighborhood={selectedNeighborhood}
        onNeighborhoodHover={setHoveredNeighborhood}
        onNeighborhoodSelect={setSelectedNeighborhood}
        onBoroughChange={(_borough, codes) => setSelectedBoroughCodes(codes)}
        onSuggestRoute={setSuggestedRoute}
        suggestedRoute={suggestedRoute}
      />
    </div>
  );
}
