import type { AssistanceProposal, PayerMemory } from "@/lib/payment-assistance";
export type AssistanceSettingsRow = { organization_id: string; mode: string; memory_enabled: boolean; reevaluation_enabled: boolean; generation: number };
export type PayerMemoryRow = PayerMemory & { source_payment_ids: string[]; confirmed_by: string; updated_at: string };
export type AssistanceProposalRow = { id: string; organization_id: string; generation: number; input_hash: string; engine_version: string; kind: string; status: string; proposal: AssistanceProposal; created_at: string; decided_at: string | null; decided_by: string | null };
export type AssistanceJobRow = { organization_id: string; requested_generation: number; completed_generation: number; attempts: number; available_at: string; lease_token: string | null; lease_until: string | null; last_error: string | null; duration_ms: number | null; updated_at: string };
export type AssistanceEventRow = { id: number; organization_id: string; entity_id: string; event_type: string; actor_user: string | null; snapshot: import("./database").Json; recorded_at: string };
export type AssistanceTable<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
