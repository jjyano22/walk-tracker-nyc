"use client";

import { useState } from "react";
import WalkMap from "@/components/Map/WalkMap";
import Sidebar from "@/components/Sidebar/Sidebar";

export default function Home() {
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string | null>(null);

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950">
      <WalkMap
        onNeighborhoodClick={(code) => setSelectedNeighborhood(code)}
      />
      <Sidebar selectedNeighborhood={selectedNeighborhood} />
    </div>
  );
}
