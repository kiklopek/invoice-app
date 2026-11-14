import { publicApiOpenApi } from "@/lib/public-api-openapi";

export async function GET() {
  return Response.json(publicApiOpenApi, {
    headers: {
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
