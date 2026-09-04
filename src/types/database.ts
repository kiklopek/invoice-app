export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      auth_request_events: {
        Row: {
          action: string
          allowed: boolean
          id: number
          requested_at: string
          subject_hash: string
        }
        Insert: {
          action: string
          allowed: boolean
          id?: never
          requested_at?: string
          subject_hash: string
        }
        Update: {
          action?: string
          allowed?: boolean
          id?: never
          requested_at?: string
          subject_hash?: string
        }
        Relationships: []
      }
      bank_payments: {
        Row: {
          amount: number
          booked_on: string
          counterparty_account: string | null
          counterparty_name: string | null
          created_at: string
          currency: string
          external_id: string
          id: string
          imported_by: string | null
          invoice_id: string | null
          match_status: string
          matched_at: string | null
          note: string | null
          organization_id: string
          unmatched_at: string | null
          unmatched_by: string | null
          variable_symbol: string | null
        }
        Insert: {
          amount: number
          booked_on: string
          counterparty_account?: string | null
          counterparty_name?: string | null
          created_at?: string
          currency: string
          external_id: string
          id?: string
          imported_by?: string | null
          invoice_id?: string | null
          match_status?: string
          matched_at?: string | null
          note?: string | null
          organization_id: string
          unmatched_at?: string | null
          unmatched_by?: string | null
          variable_symbol?: string | null
        }
        Update: {
          amount?: number
          booked_on?: string
          counterparty_account?: string | null
          counterparty_name?: string | null
          created_at?: string
          currency?: string
          external_id?: string
          id?: string
          imported_by?: string | null
          invoice_id?: string | null
          match_status?: string
          matched_at?: string | null
          note?: string | null
          organization_id?: string
          unmatched_at?: string | null
          unmatched_by?: string | null
          variable_symbol?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_payments_invoice_same_org_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "bank_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_mfa_challenges: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          session_id: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id: string
          session_id: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          id: string
          last_event_at: string
          organization_id: string
          provider_message_id: string | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          last_event_at: string
          organization_id: string
          provider_message_id?: string | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          last_event_at?: string
          organization_id?: string
          provider_message_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          cc: string[] | null
          id: string
          organization_id: string
          reply_to: string | null
          stage: string
          subject: string
          updated_at: string
        }
        Insert: {
          body: string
          cc?: string[] | null
          id?: string
          organization_id: string
          reply_to?: string | null
          stage: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string
          cc?: string[] | null
          id?: string
          organization_id?: string
          reply_to?: string | null
          stage?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          invoice_id: string
          organization_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          invoice_id: string
          organization_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          invoice_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_events_invoice_same_org_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_uploads: {
        Row: {
          created_at: string
          created_by: string | null
          expected_mime: string
          expected_size: number
          expires_at: string
          id: string
          invoice_id: string | null
          ocr_attempt_count: number
          ocr_completed_at: string | null
          ocr_error: string | null
          ocr_model: string | null
          ocr_provider_response_id: string | null
          ocr_started_at: string | null
          ocr_status: string
          organization_id: string
          original_name: string
          path: string
          status: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_mime: string
          expected_size: number
          expires_at: string
          id?: string
          invoice_id?: string | null
          ocr_attempt_count?: number
          ocr_completed_at?: string | null
          ocr_error?: string | null
          ocr_model?: string | null
          ocr_provider_response_id?: string | null
          ocr_started_at?: string | null
          ocr_status?: string
          organization_id: string
          original_name: string
          path: string
          status?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_mime?: string
          expected_size?: number
          expires_at?: string
          id?: string
          invoice_id?: string | null
          ocr_attempt_count?: number
          ocr_completed_at?: string | null
          ocr_error?: string | null
          ocr_model?: string | null
          ocr_provider_response_id?: string | null
          ocr_started_at?: string | null
          ocr_status?: string
          organization_id?: string
          original_name?: string
          path?: string
          status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_uploads_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_uploads_invoice_same_org_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          amount_without_vat: number
          counterparty_dic: string | null
          counterparty_email: string
          counterparty_ico: string | null
          counterparty_name: string
          created_at: string
          created_by: string | null
          currency: string
          due_date: string
          file_url: string | null
          id: string
          invoice_number: string
          issue_date: string
          last_reminder_at: string | null
          next_reminder_at: string | null
          notes: string | null
          organization_id: string
          paid_amount: number
          paid_at: string | null
          reminder_policy_id: string | null
          reminders_paused: boolean
          reminders_paused_at: string | null
          reminders_paused_by: string | null
          reminders_sent: number
          source: string
          status: string
          updated_at: string
          updated_by: string | null
          variable_symbol: string | null
          vat_rate: number
        }
        Insert: {
          amount: number
          amount_without_vat: number
          counterparty_dic?: string | null
          counterparty_email: string
          counterparty_ico?: string | null
          counterparty_name: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date: string
          file_url?: string | null
          id?: string
          invoice_number: string
          issue_date: string
          last_reminder_at?: string | null
          next_reminder_at?: string | null
          notes?: string | null
          organization_id: string
          paid_amount?: number
          paid_at?: string | null
          reminder_policy_id?: string | null
          reminders_paused?: boolean
          reminders_paused_at?: string | null
          reminders_paused_by?: string | null
          reminders_sent?: number
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          variable_symbol?: string | null
          vat_rate?: number
        }
        Update: {
          amount?: number
          amount_without_vat?: number
          counterparty_dic?: string | null
          counterparty_email?: string
          counterparty_ico?: string | null
          counterparty_name?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date?: string
          file_url?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          last_reminder_at?: string | null
          next_reminder_at?: string | null
          notes?: string | null
          organization_id?: string
          paid_amount?: number
          paid_at?: string | null
          reminder_policy_id?: string | null
          reminders_paused?: boolean
          reminders_paused_at?: string | null
          reminders_paused_by?: string | null
          reminders_sent?: number
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          variable_symbol?: string | null
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_policy_same_org_fkey"
            columns: ["organization_id", "reminder_policy_id"]
            isOneToOne: false
            referencedRelation: "reminder_policies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoices_reminder_policy_id_fkey"
            columns: ["reminder_policy_id"]
            isOneToOne: false
            referencedRelation: "reminder_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_member_events: {
        Row: {
          actor_email: string
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          new_role: string | null
          organization_id: string
          previous_role: string | null
          target_email: string
          target_member_id: string
        }
        Insert: {
          actor_email: string
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          new_role?: string | null
          organization_id: string
          previous_role?: string | null
          target_email: string
          target_member_id: string
        }
        Update: {
          actor_email?: string
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          new_role?: string | null
          organization_id?: string
          previous_role?: string | null
          target_email?: string
          target_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_member_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          email: string
          id: string
          organization_id: string
          role: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          organization_id: string
          role?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          organization_id?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          bank_account_czk: string | null
          bank_account_eur: string | null
          created_at: string
          data_box_id: string | null
          dic: string | null
          email: string | null
          ico: string | null
          id: string
          name: string
          operating_address: string | null
          phone: string | null
          registered_address: string | null
        }
        Insert: {
          bank_account_czk?: string | null
          bank_account_eur?: string | null
          created_at?: string
          data_box_id?: string | null
          dic?: string | null
          email?: string | null
          ico?: string | null
          id?: string
          name: string
          operating_address?: string | null
          phone?: string | null
          registered_address?: string | null
        }
        Update: {
          bank_account_czk?: string | null
          bank_account_eur?: string | null
          created_at?: string
          data_box_id?: string | null
          dic?: string | null
          email?: string | null
          ico?: string | null
          id?: string
          name?: string
          operating_address?: string | null
          phone?: string | null
          registered_address?: string | null
        }
        Relationships: []
      }
      provider_webhook_events: {
        Row: {
          event_at: string
          event_id: string
          event_type: string
          provider_message_id: string
          received_at: string
        }
        Insert: {
          event_at: string
          event_id: string
          event_type: string
          provider_message_id: string
          received_at?: string
        }
        Update: {
          event_at?: string
          event_id?: string
          event_type?: string
          provider_message_id?: string
          received_at?: string
        }
        Relationships: []
      }
      reminder_automation_runs: {
        Row: {
          checked: number
          disabled: number
          error_message: string | null
          exhausted: number
          failed: number
          finished_at: string | null
          id: string
          organization_id: string
          paused: number
          run_key: string
          sent: number
          skipped: number
          started_at: string
          status: string
          suppressed: number
          trigger_source: string
          triggered_by: string | null
          triggered_by_email: string | null
        }
        Insert: {
          checked?: number
          disabled?: number
          error_message?: string | null
          exhausted?: number
          failed?: number
          finished_at?: string | null
          id?: string
          organization_id: string
          paused?: number
          run_key: string
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          suppressed?: number
          trigger_source?: string
          triggered_by?: string | null
          triggered_by_email?: string | null
        }
        Update: {
          checked?: number
          disabled?: number
          error_message?: string | null
          exhausted?: number
          failed?: number
          finished_at?: string | null
          id?: string
          organization_id?: string
          paused?: number
          run_key?: string
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          suppressed?: number
          trigger_source?: string
          triggered_by?: string | null
          triggered_by_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_automation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_log: {
        Row: {
          attempt_count: number
          created_at: string
          delivered_at: string | null
          delivery_error: string | null
          delivery_event_at: string | null
          delivery_status: string | null
          error_message: string | null
          id: string
          invoice_id: string
          organization_id: string
          provider_message_id: string | null
          scheduled_for: string
          sent_at: string | null
          sent_to: string
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_event_at?: string | null
          delivery_status?: string | null
          error_message?: string | null
          id?: string
          invoice_id: string
          organization_id: string
          provider_message_id?: string | null
          scheduled_for: string
          sent_at?: string | null
          sent_to: string
          stage: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_event_at?: string | null
          delivery_status?: string | null
          error_message?: string | null
          id?: string
          invoice_id?: string
          organization_id?: string
          provider_message_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          sent_to?: string
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_log_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_log_invoice_same_org_fkey"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "reminder_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_policies: {
        Row: {
          created_at: string
          days_from_due: number[]
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          days_from_due?: number[]
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          days_from_due?: number[]
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_settings_events: {
        Row: {
          actor_email: string
          actor_user_id: string | null
          created_at: string
          days_from_due: number[]
          id: string
          is_active: boolean
          organization_id: string
          template_data: Json
        }
        Insert: {
          actor_email: string
          actor_user_id?: string | null
          created_at?: string
          days_from_due: number[]
          id?: string
          is_active: boolean
          organization_id: string
          template_data: Json
        }
        Update: {
          actor_email?: string
          actor_user_id?: string | null
          created_at?: string
          days_from_due?: number[]
          id?: string
          is_active?: boolean
          organization_id?: string
          template_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "reminder_settings_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_organization_member: {
        Args: {
          actor_user: string
          new_email: string
          new_role: string
          target_org: string
        }
        Returns: Json
      }
      assign_bank_payment: {
        Args: {
          actor_user: string
          target_invoice: string
          target_org: string
          target_payment: string
        }
        Returns: Json
      }
      claim_invoice_ocr: {
        Args: { target_upload_id: string; target_user_id: string }
        Returns: boolean
      }
      complete_reminder_send: {
        Args: {
          next_time: string
          provider_id: string
          sent_time: string
          target_log_id: string
        }
        Returns: boolean
      }
      consume_auth_rate_limit: {
        Args: {
          target_action: string
          target_max_attempts: number
          target_subject_hash: string
          target_window_seconds: number
        }
        Returns: boolean
      }
      create_email_mfa_challenge: {
        Args: {
          target_challenge: string
          target_code_hash: string
          target_expires_at: string
          target_session: string
          target_user: string
        }
        Returns: string
      }
      dashboard_summary: {
        Args: { actor_user: string; target_org: string }
        Returns: Json
      }
      delete_invoice_safely: {
        Args: { actor_user: string; target_invoice: string; target_org: string }
        Returns: Json
      }
      delete_organization_member: {
        Args: { actor_user: string; target_member: string; target_org: string }
        Returns: Json
      }
      import_and_reconcile_bank_payments: {
        Args: { actor_user: string; payment_rows: Json; target_org: string }
        Returns: Json
      }
      invoice_report_rows_page: {
        Args: {
          actor_user: string
          currency_filter: string
          customer_filter?: string
          date_basis: string
          page_number?: number
          page_size?: number
          report_from: string
          report_to: string
          status_filter?: string
          target_org: string
        }
        Returns: Json
      }
      invoice_report_summary: {
        Args: {
          actor_user: string
          as_of_date?: string
          currency_filter: string
          customer_filter?: string
          date_basis: string
          report_from: string
          report_to: string
          status_filter?: string
          target_org: string
        }
        Returns: Json
      }
      list_invoices_page: {
        Args: {
          actor_user: string
          currency_filter?: string
          issue_from?: string
          issue_to?: string
          page_number?: number
          page_size?: number
          search_query?: string
          status_filter?: string
          target_org: string
        }
        Returns: Json
      }
      process_resend_delivery_event: {
        Args: {
          event_error: string
          event_time: string
          message_id: string
          webhook_event_id: string
          webhook_event_type: string
        }
        Returns: Json
      }
      record_reminder_sent: {
        Args: {
          next_time: string
          sent_time: string
          target_invoice_id: string
        }
        Returns: undefined
      }
      reopen_paid_invoice: {
        Args: {
          actor_user: string
          new_status: string
          next_time: string
          target_invoice: string
          target_org: string
        }
        Returns: Json
      }
      restore_organization_member_after_auth_delete_failure: {
        Args: {
          actor_user: string
          target_created: string
          target_email: string
          target_member: string
          target_org: string
          target_role: string
          target_user: string
        }
        Returns: Json
      }
      save_default_reminder_settings: {
        Args: {
          actor_user: string
          new_active: boolean
          new_days: number[]
          target_org: string
          template_data: Json
        }
        Returns: Json
      }
      unassign_bank_payment: {
        Args: { actor_user: string; target_org: string; target_payment: string }
        Returns: Json
      }
      update_organization_member_role: {
        Args: {
          actor_user: string
          new_role: string
          target_member: string
          target_org: string
        }
        Returns: Json
      }
      verify_email_mfa_challenge: {
        Args: {
          candidate_hash: string
          target_challenge: string
          target_session: string
          target_user: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
