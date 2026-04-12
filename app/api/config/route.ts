export async function GET() {
  return Response.json({
    mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "",
  });
}
