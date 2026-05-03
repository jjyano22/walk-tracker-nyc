import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
        }}
      >
        <svg width="112" height="112" viewBox="0 0 100 100" fill="none">
          <path
            d="M 30 82 L 30 50 L 70 50 L 70 18"
            stroke="#00ffd5"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="70" cy="18" r="8" fill="#00ffd5" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
