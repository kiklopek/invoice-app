import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import type {
  NetworkOverview,
  PartnerDetail,
  PartnerDetailPageData,
  PartnersPageData,
  ReceivedInvoice,
  ReceivedInvoicesPageData,
} from "@/lib/partner-network";
import { canManageNetwork, canViewNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

// Data stránek Splatno Sítě. Všechno jde přes funkce network_* v databázi,
// které samy ověří roli i aktivní propojení; organizace a uživatel jsou
// vždy z identity, nikdy z požadavku.

function requireNetworkAccess(identity: RequestIdentity | null): RequestIdentity {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewNetwork(identity.membership.role)) throw new PageDataError("K síti partnerů nemáte přístup.", 403);
  return identity;
}

export async function loadPartnersPageData(identity: RequestIdentity | null): Promise<PartnersPageData> {
  const current = requireNetworkAccess(identity);
  const { data, error } = await current.service.rpc("network_overview", {
    target_org: current.membership.organization_id,
    actor_user: current.user.id,
  });
  if (error || !data) {
    logError("Přehled sítě partnerů se nepodařilo načíst", error);
    throw new PageDataError("Partnery se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500);
  }
  return { ...(data as NetworkOverview), can_manage: canManageNetwork(current.membership.role) };
}

export async function loadPartnerDetailPageData(identity: RequestIdentity | null, connectionId: string): Promise<PartnerDetailPageData> {
  const current = requireNetworkAccess(identity);
  const { data, error } = await current.service.rpc("network_partner", {
    target_org: current.membership.organization_id,
    actor_user: current.user.id,
    target_connection: connectionId,
  });
  if (error) {
    logError("Detail partnera se nepodařilo načíst", error, { connection_id: connectionId });
    throw new PageDataError("Detail partnera se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500);
  }
  if (!data) throw new PageDataError("Propojení nebylo nalezeno nebo už není aktivní.", 404);
  return { ...(data as PartnerDetail), can_manage: canManageNetwork(current.membership.role) };
}

export async function loadReceivedInvoicesPageData(identity: RequestIdentity | null): Promise<ReceivedInvoicesPageData> {
  const current = requireNetworkAccess(identity);
  const { data, error } = await current.service.rpc("network_received", {
    target_org: current.membership.organization_id,
    actor_user: current.user.id,
  });
  if (error) {
    logError("Přijaté faktury od partnerů se nepodařilo načíst", error);
    throw new PageDataError("Přijaté faktury se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500);
  }
  return { invoices: (data ?? []) as ReceivedInvoice[] };
}
