import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

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
          background: "#f5f0eb",
          borderRadius: 96,
        }}
      >
        <svg width="320" height="320" viewBox="0 0 100 100" fill="none">
          <path
            d="M 30 82 L 30 50 L 70 50 L 70 18"
            stroke="#6d28d9"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="70" cy="18" r="8" fill="#6d28d9" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
