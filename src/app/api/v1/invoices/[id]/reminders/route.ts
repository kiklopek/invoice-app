import { publicApi, readApiJson, apiResourceId, apiQueryError, apiNotFound } from "@/lib/public-api";
import { apiObject, PublicApiError } from "@/lib/public-api-input";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return publicApi(request, "reminders:write", async identity => {
    const id = apiResourceId((await params).id);
    const body = apiObject(await readApiJson(request), ["paused"]);
    if (typeof body.paused !== "boolean") throw new PublicApiError("Pole paused musí být true nebo false.");
    const { data, error } = await identity.service.rpc("set_api_invoice_reminders", {
      target_org: identity.organizationId, actor_user: identity.actingUserId, target_invoice: id, paused: body.paused,
    });
    if (error?.code === "P0002") apiNotFound("Doklad");
    if (error?.code === "42501") throw new PublicApiError("Integrace už nemá oprávnění změnit upomínky.", 403, "insufficient_scope");
    if (error?.code === "55000") throw new PublicApiError("Upomínka se právě odesílá. Vyčkejte na výsledek a požadavek zopakujte.", 409, "reminder_in_flight");
    apiQueryError(error);
    if (!data) apiNotFound("Doklad");
    return Response.json({ reminders: data });
  });
}
