import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Renders a dark square with a walking-figure glyph in the app's
// signature cyan (#00ffd5). Used for favicon, Android, PWA manifest.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          borderRadius: 96,
        }}
      >
        <svg
          width="320"
          height="320"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#00ffd5"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="13" cy="4" r="2" />
          <path d="m6 15 3-2 1-4 3 2 3 4" />
          <path d="m10 9 4 2 3 5-4 3" />
          <path d="M6 15v5" />
          <path d="m17 17 3 3" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
