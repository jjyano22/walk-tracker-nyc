"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import Sidebar from "@/components/Sidebar/Sidebar";

const WalkMap = dynamic(() => import("@/components/Map/WalkMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-zinc-950">
      <div className="text-zinc-400 text-lg">Loading map...</div>
    </div>
  ),
});

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
