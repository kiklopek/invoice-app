import { publicApi, apiQueryError, apiNotFound } from "@/lib/public-api";
export async function GET(request: Request) {
  return publicApi(request, "company:read", async identity => {
    const { data, error } = await identity.service.from("organizations").select("id,name,ico,dic,registered_address,email,vat_payer,bank_account_czk,bank_account_eur,bank_accounts:organization_bank_accounts(account,currency)").eq("id", identity.organizationId).single();
    apiQueryError(error); if (!data) apiNotFound("Firma");
    return Response.json({ company: data });
  });
}
