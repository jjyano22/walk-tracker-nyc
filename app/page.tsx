"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import Sidebar from "@/components/Sidebar/Sidebar";

const WalkMap = dynamic(() => import("@/components/Map/WalkMap"), { ssr: false });

export default function Home() {
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string | null>(null);
  const [hoveredNeighborhood, setHoveredNeighborhood] = useState<string | null>(null);

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh" }}>
      <WalkMap
        onNeighborhoodClick={(code) => setSelectedNeighborhood(code)}
        hoveredNeighborhood={hoveredNeighborhood}
        selectedNeighborhood={selectedNeighborhood}
      />
      <Sidebar
        selectedNeighborhood={selectedNeighborhood}
        onNeighborhoodHover={setHoveredNeighborhood}
        onNeighborhoodSelect={setSelectedNeighborhood}
      />
    </div>
  );
}
