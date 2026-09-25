export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      bank_payment_allocations: {
        Row: {
          amount: number
          bank_payment_id: string | null
          committed_at: string | null
          created_at: string
          created_by: string
          id: string
          invoice_id: string
          is_committed: boolean
          is_manual_partial: boolean
          organization_id: string
          statement_entry_id: string | null
        }
        Insert: {
          amount: number
          bank_payment_id?: string | null
          committed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          invoice_id: string
          is_committed?: boolean
          is_manual_partial?: boolean
          organization_id: string
          statement_entry_id?: string | null
        }
        Update: {
          amount?: number
          bank_payment_id?: string | null
          committed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          invoice_id?: string
          is_committed?: boolean
          is_manual_partial?: boolean
          organization_id?: string
          statement_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_payment_allocations_bank_payment_id_fkey"
            columns: ["bank_payment_id"]
            isOneToOne: false
            referencedRelation: "bank_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_payment_allocations_entry_same_org"
            columns: ["organization_id", "statement_entry_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_entries"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "bank_payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_payment_allocations_invoice_same_org"
            columns: ["organization_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "bank_payment_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_payment_allocations_payment_same_org"
            columns: ["organization_id", "bank_payment_id"]
            isOneToOne: false
            referencedRelation: "bank_payments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "bank_payment_allocations_statement_entry_id_fkey"
            columns: ["statement_entry_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_entries"
            referencedColumns: ["id"]
          },
        ]
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
          match_reason: string | null
          matched_at: string | null
          note: string | null
          organization_id: string
          source: string
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
          match_reason?: string | null
          matched_at?: string | null
          note?: string | null
          organization_id: string
          source?: string
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
          match_reason?: string | null
          matched_at?: string | null
          note?: string | null
          organization_id?: string
          source?: string
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
      bank_statement_entries: {
        Row: {
          amount: number | null
          bank_payment_id: string | null
          booked_on: string | null
          counterparty_account: string | null
          counterparty_name: string | null
          created_at: string
          currency: string | null
          disposition: string
          external_id: string | null
          fingerprint: string
          id: string
          import_id: string
          line_number: number
          note: string | null
          organization_id: string
          proposal_confidence: string | null
          proposal_kind: string | null
          proposal_reason: string | null
          proposed_invoice_ids: string[]
          reason: string | null
          record_type: string
          variable_symbol: string | null
        }
        Insert: {
          amount?: number | null
          bank_payment_id?: string | null
          booked_on?: string | null
          counterparty_account?: string | null
          counterparty_name?: string | null
          created_at?: string
          currency?: string | null
          disposition: string
          external_id?: string | null
          fingerprint: string
          id?: string
          import_id: string
          line_number: number
          note?: string | null
          organization_id: string
          proposal_confidence?: string | null
          proposal_kind?: string | null
          proposal_reason?: string | null
          proposed_invoice_ids?: string[]
          reason?: string | null
          record_type: string
          variable_symbol?: string | null
        }
        Update: {
          amount?: number | null
          bank_payment_id?: string | null
          booked_on?: string | null
          counterparty_account?: string | null
          counterparty_name?: string | null
          created_at?: string
          currency?: string | null
          disposition?: string
          external_id?: string | null
          fingerprint?: string
          id?: string
          import_id?: string
          line_number?: number
          note?: string | null
          organization_id?: string
          proposal_confidence?: string | null
          proposal_kind?: string | null
          proposal_reason?: string | null
          proposed_invoice_ids?: string[]
          reason?: string | null
          record_type?: string
          variable_symbol?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_entries_bank_payment_id_fkey"
            columns: ["bank_payment_id"]
            isOneToOne: false
            referencedRelation: "bank_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_entries_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_entries_import_same_org"
            columns: ["organization_id", "import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "bank_statement_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_imports: {
        Row: {
          accepted_count: number
          account_mismatch: boolean
          account_mismatch_acknowledged: boolean
          committed_at: string | null
          committed_by: string | null
          created_at: string
          created_by: string
          entry_count: number
          error_count: number
          failure_reason: string | null
          file_hash: string
          id: string
          ignored_count: number
          organization_id: string
          original_filename: string
          period_from: string | null
          period_to: string | null
          revision: number
          source_format: string
          statement_account: string | null
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          accepted_count?: number
          account_mismatch?: boolean
          account_mismatch_acknowledged?: boolean
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by: string
          entry_count?: number
          error_count?: number
          failure_reason?: string | null
          file_hash: string
          id?: string
          ignored_count?: number
          organization_id: string
          original_filename: string
          period_from?: string | null
          period_to?: string | null
          revision?: number
          source_format: string
          statement_account?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          accepted_count?: number
          account_mismatch?: boolean
          account_mismatch_acknowledged?: boolean
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string
          entry_count?: number
          error_count?: number
          failure_reason?: string | null
          file_hash?: string
          id?: string
          ignored_count?: number
          organization_id?: string
          original_filename?: string
          period_from?: string | null
          period_to?: string | null
          revision?: number
          source_format?: string
          statement_account?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_registry_cache: {
        Row: {
          fetched_at: string
          ico: string
          legal_name: string | null
          lookup_status: string
        }
        Insert: {
          fetched_at?: string
          ico: string
          legal_name?: string | null
          lookup_status: string
        }
        Update: {
          fetched_at?: string
          ico?: string
          legal_name?: string | null
          lookup_status?: string
        }
        Relationships: []
      }
      counterparty_payment_accounts: {
        Row: {
          account_number: string
          confirmed_at: string
          confirmed_by: string
          counterparty_ico: string
          id: string
          last_used_at: string
          organization_id: string
        }
        Insert: {
          account_number: string
          confirmed_at?: string
          confirmed_by: string
          counterparty_ico: string
          id?: string
          last_used_at?: string
          organization_id: string
        }
        Update: {
          account_number?: string
          confirmed_at?: string
          confirmed_by?: string
          counterparty_ico?: string
          id?: string
          last_used_at?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterparty_payment_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparty_reminder_preferences: {
        Row: {
          counterparty_ico: string
          created_at: string
          last_invoice_id: string | null
          organization_id: string
          reminder_policy_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          counterparty_ico: string
          created_at?: string
          last_invoice_id?: string | null
          organization_id: string
          reminder_policy_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          counterparty_ico?: string
          created_at?: string
          last_invoice_id?: string | null
          organization_id?: string
          reminder_policy_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counterparty_reminder_preferences_invoice_same_org_fkey"
            columns: ["organization_id", "last_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "counterparty_reminder_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparty_reminder_preferences_policy_same_org_fkey"
            columns: ["organization_id", "reminder_policy_id"]
            isOneToOne: false
            referencedRelation: "reminder_policies"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          created_by: string | null
          dic: string | null
          email: string | null
          ico: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dic?: string | null
          email?: string | null
          ico?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dic?: string | null
          email?: string | null
          ico?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
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
      invoice_ocr_keyword_suggestions: {
        Row: {
          created_at: string
          example_label: string
          id: string
          normalized_label: string
          organization_id: string
          status: string
          upload_id: string
          vocabulary_version: string
        }
        Insert: {
          created_at?: string
          example_label: string
          id?: string
          normalized_label: string
          organization_id: string
          status?: string
          upload_id: string
          vocabulary_version: string
        }
        Update: {
          created_at?: string
          example_label?: string
          id?: string
          normalized_label?: string
          organization_id?: string
          status?: string
          upload_id?: string
          vocabulary_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_ocr_keyword_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_ocr_keyword_suggestions_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "invoice_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_ocr_reviews: {
        Row: {
          corrected_fields: string[]
          created_at: string
          field_decisions: Json
          final_values: Json
          id: string
          invoice_id: string
          ocr_model: string
          organization_id: string
          proposed_values: Json
          reviewed_by: string | null
          upload_id: string | null
          vocabulary_version: string
        }
        Insert: {
          corrected_fields?: string[]
          created_at?: string
          field_decisions?: Json
          final_values: Json
          id?: string
          invoice_id: string
          ocr_model: string
          organization_id: string
          proposed_values: Json
          reviewed_by?: string | null
          upload_id?: string | null
          vocabulary_version: string
        }
        Update: {
          corrected_fields?: string[]
          created_at?: string
          field_decisions?: Json
          final_values?: Json
          id?: string
          invoice_id?: string
          ocr_model?: string
          organization_id?: string
          proposed_values?: Json
          reviewed_by?: string | null
          upload_id?: string | null
          vocabulary_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_ocr_reviews_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_ocr_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_ocr_reviews_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: true
            referencedRelation: "invoice_uploads"
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
          ocr_field_decisions: Json
          ocr_field_sources: Json
          ocr_money_snapshot: Json | null
          ocr_model: string | null
          ocr_provider_response_id: string | null
          ocr_proposed_values: Json
          ocr_started_at: string | null
          ocr_status: string
          ocr_vocabulary_version: string | null
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
          ocr_field_decisions?: Json
          ocr_field_sources?: Json
          ocr_money_snapshot?: Json | null
          ocr_model?: string | null
          ocr_provider_response_id?: string | null
          ocr_proposed_values?: Json
          ocr_started_at?: string | null
          ocr_status?: string
          ocr_vocabulary_version?: string | null
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
          ocr_field_decisions?: Json
          ocr_field_sources?: Json
          ocr_money_snapshot?: Json | null
          ocr_model?: string | null
          ocr_provider_response_id?: string | null
          ocr_proposed_values?: Json
          ocr_started_at?: string | null
          ocr_status?: string
          ocr_vocabulary_version?: string | null
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
          money_evidence: Json | null
          amount: number
          amount_without_vat: number
          counterparty_dic: string | null
          counterparty_email: string
          counterparty_ico: string | null
          counterparty_name: string
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
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
          reminder_days_snapshot: number[]
          reminder_plan_effective_from: string | null
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
          money_evidence?: Json | null
          amount: number
          amount_without_vat: number
          counterparty_dic?: string | null
          counterparty_email: string
          counterparty_ico?: string | null
          counterparty_name: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
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
          reminder_days_snapshot?: number[]
          reminder_plan_effective_from?: string | null
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
          money_evidence?: Json | null
          amount?: number
          amount_without_vat?: number
          counterparty_dic?: string | null
          counterparty_email?: string
          counterparty_ico?: string | null
          counterparty_name?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
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
          reminder_days_snapshot?: number[]
          reminder_plan_effective_from?: string | null
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
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
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
          ocr_hourly_limit: number | null
          operating_address: string | null
          phone: string | null
          registered_address: string | null
          settings_revision: number
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
          ocr_hourly_limit?: number | null
          operating_address?: string | null
          phone?: string | null
          registered_address?: string | null
          settings_revision?: number
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
          ocr_hourly_limit?: number | null
          operating_address?: string | null
          phone?: string | null
          registered_address?: string | null
          settings_revision?: number
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
          planner_duration_ms: number
          processed: number
          queued: number
          remaining: number
          run_key: string
          sent: number
          skipped: number
          started_at: string
          status: string
          suppressed: number
          trigger_source: string
          triggered_by: string | null
          triggered_by_email: string | null
          worker_duration_ms: number
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
          planner_duration_ms?: number
          processed?: number
          queued?: number
          remaining?: number
          run_key: string
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          suppressed?: number
          trigger_source?: string
          triggered_by?: string | null
          triggered_by_email?: string | null
          worker_duration_ms?: number
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
          planner_duration_ms?: number
          processed?: number
          queued?: number
          remaining?: number
          run_key?: string
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          suppressed?: number
          trigger_source?: string
          triggered_by?: string | null
          triggered_by_email?: string | null
          worker_duration_ms?: number
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
          available_at: string
          created_at: string
          delivered_at: string | null
          delivery_error: string | null
          delivery_event_at: string | null
          delivery_status: string | null
          error_message: string | null
          id: string
          invoice_id: string
          lease_expires_at: string | null
          lease_token: string | null
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
          available_at?: string
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_event_at?: string | null
          delivery_status?: string | null
          error_message?: string | null
          id?: string
          invoice_id: string
          lease_expires_at?: string | null
          lease_token?: string | null
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
          available_at?: string
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_event_at?: string | null
          delivery_status?: string | null
          error_message?: string | null
          id?: string
          invoice_id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
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
          archived_at: string | null
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
          archived_at?: string | null
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
          archived_at?: string | null
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
      invoice_ocr_field_accuracy: {
        Row: {
          accepted_count: number | null
          field_name: string | null
          organization_id: string | null
          accuracy_percent: number | null
          reviewed_count: number | null
          vocabulary_version: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_ocr_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      reconcile_bank_statement: {
        Args: { target_org: string; actor_user: string; target_import: string; expected_revision: number; automatic_only?: boolean; acknowledge_account_mismatch?: boolean }
        Returns: Json
      }
      run_bank_reconciliation_jobs: { Args: Record<PropertyKey, never>; Returns: Json }
      discard_bank_statement_import: {
        Args: { target_org: string; actor_user: string; target_import: string; expected_revision: number; reason?: string | null }
        Returns: Json
      }
      release_statement_entry: {
        Args: { target_org: string; actor_user: string; target_entry: string }
        Returns: Json
      }
      audit_invoice_money: {
        Args: { target_org: string }
        Returns: { invoice_id: string; invoice_number: string; amount: number; paid_amount: number; ledger_paid: number; formula_difference: number; original_difference: number | null }[]
      }
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
      claim_reminder_jobs: {
        Args: {
          target_lease_seconds?: number
          target_limit?: number
          target_now?: string
          target_organizations: string[]
          target_worker: string
        }
        Returns: {
          attempt_count: number
          id: string
          invoice_id: string
          lease_token: string
          organization_id: string
          scheduled_for: string
          stage: string
        }[]
      }
      commit_bank_statement_import: {
        Args: {
          acknowledge_account_mismatch?: boolean
          actor_user: string
          expected_revision: number
          target_import: string
          target_org: string
        }
        Returns: Json
      }
      complete_claimed_reminder_send: {
        Args: {
          next_time: string
          provider_id: string
          sent_time: string
          target_lease_token: string
          target_log_id: string
        }
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
      confirm_manual_payment: {
        Args: {
          actor_user: string
          paid_on: string
          payment_amount: number
          target_invoice: string
          target_org: string
        }
        Returns: Json
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
      create_bank_statement_preview: {
        Args: {
          actor_user: string
          entry_rows: Json
          import_data: Json
          target_org: string
        }
        Returns: Json
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
      fail_claimed_reminder_job: {
        Args: {
          failed_time?: string
          failure_message: string
          retry_time: string
          target_lease_token: string
          target_log_id: string
        }
        Returns: boolean
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
      list_invoices_page_filtered: {
        Args: {
          actor_user: string
          amount_max?: number
          amount_min?: number
          bank_match_state?: string
          currency_filter?: string
          due_from?: string
          due_to?: string
          issue_from?: string
          issue_to?: string
          page_number?: number
          page_size?: number
          payment_state?: string
          search_query?: string
          status_filter?: string
          target_org: string
        }
        Returns: Json
      }
      list_open_invoice_candidates: {
        Args: {
          actor_user: string
          page_number?: number
          page_size?: number
          search_query?: string
          target_org: string
        }
        Returns: Json
      }
      payment_reconciliation_summary: {
        Args: {
          actor_user: string
          report_from: string
          report_to: string
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
      refresh_reminder_next_times: {
        Args: { automation_active: boolean; target_org: string }
        Returns: undefined
      }
      release_claimed_reminder_jobs: {
        Args: {
          released_time?: string
          target_lease_token: string
          target_log_ids: string[]
        }
        Returns: number
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
      save_bank_statement_allocations: {
        Args: {
          actor_user: string
          allocation_rows: Json
          expected_revision: number
          reviewed_entries: Json
          target_import: string
          target_org: string
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
      save_default_reminder_settings_versioned: {
        Args: {
          actor_user: string
          expected_event?: string
          new_active: boolean
          new_days: number[]
          target_org: string
          template_data: Json
        }
        Returns: Json
      }
      schedule_reminder_jobs: {
        Args: {
          target_invoice_updates: Json
          target_jobs: Json
          target_now?: string
        }
        Returns: Json
      }
      set_default_reminder_policy: {
        Args: { target_org: string; target_policy: string }
        Returns: undefined
      }
      skip_claimed_reminder_job: {
        Args: {
          skipped_time?: string
          target_lease_token: string
          target_log_id: string
        }
        Returns: boolean
      }
      unassign_bank_payment: {
        Args: { actor_user: string; target_org: string; target_payment: string }
        Returns: Json
      }
      unassign_bank_payment_allocations: {
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
      valid_reminder_days: { Args: { days: number[] }; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
