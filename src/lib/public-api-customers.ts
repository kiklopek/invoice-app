import "server-only";
import type { Database } from "@/types/database";

export const PUBLIC_CUSTOMER_FIELDS = "id, name, ico, dic, email, address, phone, created_at, updated_at";
export type PublicCustomer = Pick<Database["public"]["Tables"]["customers"]["Row"],
  "id" | "name" | "ico" | "dic" | "email" | "address" | "phone" | "created_at" | "updated_at">;
export function customerApiResponse(row: PublicCustomer): PublicCustomer {
  return { id: row.id, name: row.name, ico: row.ico, dic: row.dic, email: row.email,
    address: row.address, phone: row.phone, created_at: row.created_at, updated_at: row.updated_at };
}
