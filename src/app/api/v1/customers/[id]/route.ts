import { publicApi, readApiJson, apiQueryError, apiNotFound, apiResourceId } from "@/lib/public-api";
import { apiObject, apiText, PublicApiError } from "@/lib/public-api-input";
import { customerApiResponse, PUBLIC_CUSTOMER_FIELDS, type PublicCustomer } from "@/lib/public-api-customers";
import { isValidEmail } from "@/lib/auth-policy";
import { isBlockedReminderRecipient } from "@/lib/reminder-recipient-policy";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return publicApi(request, "customers:read", async identity => {
    const id = apiResourceId((await params).id);
    const { data, error } = await identity.service.from("customers").select(PUBLIC_CUSTOMER_FIELDS)
      .eq("organization_id",identity.organizationId).eq("id",id).maybeSingle();
    apiQueryError(error); if (!data) apiNotFound("Zákazník");
    return Response.json({ customer: customerApiResponse(data as PublicCustomer) });
  });
}
export async function PATCH(request: Request, { params }: Context) {
  return publicApi(request, "customers:write", async identity => {
    const id = apiResourceId((await params).id);
    const body = apiObject(await readApiJson(request),["email","phone"]);
    if (!("email" in body || "phone" in body)) throw new PublicApiError("Zadejte e-mail nebo telefon zákazníka.");
    const email = "email" in body ? apiText(body.email,"email",254,true).toLowerCase() : null;
    const phone = "phone" in body && body.phone !== null ? apiText(body.phone,"phone",40) || null : null;
    if (email && !isValidEmail(email)) throw new PublicApiError("Zadejte platný e-mail zákazníka.");
    const { data: customer, error: readError } = await identity.service.from("customers").select("id")
      .eq("organization_id",identity.organizationId).eq("id",id).maybeSingle();
    apiQueryError(readError); if (!customer) apiNotFound("Zákazník");
    if (email) {
      const { data: issuer,error } = await identity.service.from("organizations").select("name,email").eq("id",identity.organizationId).maybeSingle();
      apiQueryError(error); if (!issuer) apiQueryError(true);
      if (isBlockedReminderRecipient(email,issuer!)) throw new PublicApiError("E-mail pro upomínky patří vaší firmě. Zadejte adresu odběratele.");
    }
    const { data,error } = await identity.service.rpc("update_customer_contact", {
      target_org:identity.organizationId,actor_user:identity.actingUserId,target_customer:id,
      change_email:"email" in body,new_email:email,change_phone:"phone" in body,new_phone:phone,
    });
    if (error?.code === "42501") throw new PublicApiError("Oprávnění autora API klíče už není platné.",403,"insufficient_scope");
    apiQueryError(error); if (!data) apiNotFound("Zákazník");
    const result = data as unknown as { updated_invoice_count: number };
    const { data: updated,error: updatedError } = await identity.service.from("customers").select(PUBLIC_CUSTOMER_FIELDS)
      .eq("organization_id",identity.organizationId).eq("id",id).maybeSingle();
    apiQueryError(updatedError); if (!updated) apiNotFound("Zákazník");
    return Response.json({ customer: customerApiResponse(updated as PublicCustomer), updated_invoice_count:result.updated_invoice_count });
  });
}
