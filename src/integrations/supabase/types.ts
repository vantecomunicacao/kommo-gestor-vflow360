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
    PostgrestVersion: "14.15"
  }
  kommo: {
    Tables: {
      ai_provider_config: {
        Row: {
          api_key: string | null
          created_at: string
          id: string
          model: string | null
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key?: string | null
          created_at?: string
          id?: string
          model?: string | null
          provider?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string | null
          created_at?: string
          id?: string
          model?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          custom_fields: Json | null
          email: string | null
          id: string
          kommo_created_at: string | null
          kommo_id: string
          kommo_updated_at: string | null
          name: string | null
          phone: string | null
          responsible_user_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          kommo_created_at?: string | null
          kommo_id: string
          kommo_updated_at?: string | null
          name?: string | null
          phone?: string | null
          responsible_user_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          kommo_created_at?: string | null
          kommo_id?: string
          kommo_updated_at?: string | null
          name?: string | null
          phone?: string | null
          responsible_user_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          code: string | null
          created_at: string
          entity_type: string
          enums: Json | null
          field_type: string | null
          id: string
          is_predefined: boolean
          kommo_id: string
          name: string
          sort: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          entity_type: string
          enums?: Json | null
          field_type?: string | null
          id?: string
          is_predefined?: boolean
          kommo_id: string
          name: string
          sort?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          entity_type?: string
          enums?: Json | null
          field_type?: string | null
          id?: string
          is_predefined?: boolean
          kommo_id?: string
          name?: string
          sort?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_analyses: {
        Row: {
          cost_usd: number
          created_at: string
          id: string
          messages: Json
          metrics: Json
          model: string | null
          params: Json
          pinned: boolean
          prompt: string
          result: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          id?: string
          messages?: Json
          metrics?: Json
          model?: string | null
          params?: Json
          pinned?: boolean
          prompt: string
          result?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          id?: string
          messages?: Json
          metrics?: Json
          model?: string | null
          params?: Json
          pinned?: boolean
          prompt?: string
          result?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_analyses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_settings: {
        Row: {
          additional_date_field: string | null
          ai_allowed_pipeline_ids: string[] | null
          ai_insights_config: Json | null
          business_hours_end: string | null
          business_hours_start: string | null
          chart_custom_fields: string[]
          created_at: string
          custom_filters: Json
          custom_metrics: Json
          default_pipeline_ids: string[] | null
          funnel_stage_labels: Json
          funnel_stage_mapping: Json | null
          origin_field_name: string | null
          report_goals: Json
          report_rate_stages: string[] | null
          updated_at: string
          utm_campaign_field_id: string | null
          utm_content_field_id: string | null
          utm_medium_field_id: string | null
          utm_source_field_id: string | null
          utm_term_field_id: string | null
          visible_custom_fields: string[] | null
          won_stage_keys: string[] | null
          workspace_id: string
        }
        Insert: {
          additional_date_field?: string | null
          ai_allowed_pipeline_ids?: string[] | null
          ai_insights_config?: Json | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          chart_custom_fields?: string[]
          created_at?: string
          custom_filters?: Json
          custom_metrics?: Json
          default_pipeline_ids?: string[] | null
          funnel_stage_labels?: Json
          funnel_stage_mapping?: Json | null
          origin_field_name?: string | null
          report_goals?: Json
          report_rate_stages?: string[] | null
          updated_at?: string
          utm_campaign_field_id?: string | null
          utm_content_field_id?: string | null
          utm_medium_field_id?: string | null
          utm_source_field_id?: string | null
          utm_term_field_id?: string | null
          visible_custom_fields?: string[] | null
          won_stage_keys?: string[] | null
          workspace_id: string
        }
        Update: {
          additional_date_field?: string | null
          ai_allowed_pipeline_ids?: string[] | null
          ai_insights_config?: Json | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          chart_custom_fields?: string[]
          created_at?: string
          custom_filters?: Json
          custom_metrics?: Json
          default_pipeline_ids?: string[] | null
          funnel_stage_labels?: Json
          funnel_stage_mapping?: Json | null
          origin_field_name?: string | null
          report_goals?: Json
          report_rate_stages?: string[] | null
          updated_at?: string
          utm_campaign_field_id?: string | null
          utm_content_field_id?: string | null
          utm_medium_field_id?: string | null
          utm_source_field_id?: string | null
          utm_term_field_id?: string | null
          visible_custom_fields?: string[] | null
          won_stage_keys?: string[] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          account_id: string | null
          config: Json
          created_at: string
          id: string
          status: string
          subdomain: string | null
          token_secret_id: string | null
          type: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          config?: Json
          created_at?: string
          id?: string
          status?: string
          subdomain?: string | null
          token_secret_id?: string | null
          type?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          config?: Json
          created_at?: string
          id?: string
          status?: string
          subdomain?: string | null
          token_secret_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_actions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          lead_kommo_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          lead_kommo_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          lead_kommo_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_stage_events: {
        Row: {
          after_status_id: string | null
          before_status_id: string | null
          changed_at: string
          created_at: string
          event_id: string
          id: string
          lead_id: string
          pipeline_id: string | null
          workspace_id: string
        }
        Insert: {
          after_status_id?: string | null
          before_status_id?: string | null
          changed_at: string
          created_at?: string
          event_id: string
          id?: string
          lead_id: string
          pipeline_id?: string | null
          workspace_id: string
        }
        Update: {
          after_status_id?: string | null
          before_status_id?: string | null
          changed_at?: string
          created_at?: string
          event_id?: string
          id?: string
          lead_id?: string
          pipeline_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_stage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          closed_at: string | null
          closest_task_at: string | null
          contact_email: string | null
          contact_id: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          custom_fields: Json | null
          id: string
          is_deleted: boolean
          kommo_created_at: string | null
          kommo_id: string
          kommo_updated_at: string | null
          last_status_change_at: string | null
          loss_reason_id: string | null
          name: string | null
          pipeline_id: string | null
          price: number | null
          responsible_user_id: string | null
          status: string | null
          status_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          closed_at?: string | null
          closest_task_at?: string | null
          contact_email?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_fields?: Json | null
          id?: string
          is_deleted?: boolean
          kommo_created_at?: string | null
          kommo_id: string
          kommo_updated_at?: string | null
          last_status_change_at?: string | null
          loss_reason_id?: string | null
          name?: string | null
          pipeline_id?: string | null
          price?: number | null
          responsible_user_id?: string | null
          status?: string | null
          status_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          closed_at?: string | null
          closest_task_at?: string | null
          contact_email?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_fields?: Json | null
          id?: string
          is_deleted?: boolean
          kommo_created_at?: string | null
          kommo_id?: string
          kommo_updated_at?: string | null
          last_status_change_at?: string | null
          loss_reason_id?: string | null
          name?: string | null
          pipeline_id?: string | null
          price?: number | null
          responsible_user_id?: string | null
          status?: string | null
          status_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_reasons: {
        Row: {
          created_at: string
          id: string
          kommo_id: string
          name: string
          sort: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kommo_id: string
          name: string
          sort?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kommo_id?: string
          name?: string
          sort?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loss_reasons_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          id: string
          is_archive: boolean
          is_deleted: boolean
          is_main: boolean
          kommo_id: string
          name: string
          sort: number | null
          statuses: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archive?: boolean
          is_deleted?: boolean
          is_main?: boolean
          kommo_id: string
          name: string
          sort?: number | null
          statuses?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archive?: boolean
          is_deleted?: boolean
          is_main?: boolean
          kommo_id?: string
          name?: string
          sort?: number | null
          statuses?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_snapshots: {
        Row: {
          created_at: string
          date_basis: string
          frozen_at: string
          id: string
          is_partial: boolean
          metrics: Json
          month: string
          pipeline_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          date_basis: string
          frozen_at?: string
          id?: string
          is_partial?: boolean
          metrics?: Json
          month: string
          pipeline_id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          date_basis?: string
          frozen_at?: string
          id?: string
          is_partial?: boolean
          metrics?: Json
          month?: string
          pipeline_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_status: {
        Row: {
          created_at: string
          is_running: boolean
          last_sync_at: string | null
          last_sync_duration_ms: number | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_sync_warning: string | null
          leads_count: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          is_running?: boolean
          last_sync_at?: string | null
          last_sync_duration_ms?: number | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_sync_warning?: string | null
          leads_count?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          is_running?: boolean
          last_sync_at?: string | null
          last_sync_duration_ms?: number | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_sync_warning?: string | null
          leads_count?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_status_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_watermarks: {
        Row: {
          contacts_last_seen_at: string | null
          created_at: string
          events_last_seen_at: string | null
          last_run_at: string | null
          last_run_count: number | null
          last_run_error: string | null
          last_run_status: string | null
          leads_last_seen_at: string | null
          tasks_last_seen_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contacts_last_seen_at?: string | null
          created_at?: string
          events_last_seen_at?: string | null
          last_run_at?: string | null
          last_run_count?: number | null
          last_run_error?: string | null
          last_run_status?: string | null
          leads_last_seen_at?: string | null
          tasks_last_seen_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contacts_last_seen_at?: string | null
          created_at?: string
          events_last_seen_at?: string | null
          last_run_at?: string | null
          last_run_count?: number | null
          last_run_error?: string | null
          last_run_status?: string | null
          leads_last_seen_at?: string | null
          tasks_last_seen_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_watermarks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          complete_till: string | null
          created_at: string
          id: string
          is_completed: boolean
          kommo_created_at: string | null
          kommo_id: string
          kommo_updated_at: string | null
          lead_id: string | null
          responsible_user_id: string | null
          task_type_id: string | null
          text: string | null
          workspace_id: string
        }
        Insert: {
          complete_till?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          kommo_created_at?: string | null
          kommo_id: string
          kommo_updated_at?: string | null
          lead_id?: string | null
          responsible_user_id?: string | null
          task_type_id?: string | null
          text?: string | null
          workspace_id: string
        }
        Update: {
          complete_till?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          kommo_created_at?: string | null
          kommo_id?: string
          kommo_updated_at?: string | null
          lead_id?: string | null
          responsible_user_id?: string | null
          task_type_id?: string | null
          text?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          updated_at: string
          user_id: string
          view_integrations: boolean
          view_settings: boolean
          view_suggestions: boolean
        }
        Insert: {
          created_at?: string
          updated_at?: string
          user_id: string
          view_integrations?: boolean
          view_settings?: boolean
          view_suggestions?: boolean
        }
        Update: {
          created_at?: string
          updated_at?: string
          user_id?: string
          view_integrations?: boolean
          view_settings?: boolean
          view_suggestions?: boolean
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["kommo"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["kommo"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["kommo"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          kommo_id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          kommo_id: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          kommo_id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          ai_analysis_enabled: boolean
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          ai_analysis_enabled?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          ai_analysis_enabled?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_workspace_member: {
        Args: { _email: string; _workspace_id: string }
        Returns: string
      }
      can_manage_workspace: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      create_workspace: { Args: { _name: string }; Returns: string }
      get_integration_token: {
        Args: { p_integration_id: string }
        Returns: string
      }
      get_my_permissions: {
        Args: never
        Returns: {
          is_admin: boolean
          view_integrations: boolean
          view_settings: boolean
          view_suggestions: boolean
        }[]
      }
      has_role: {
        Args: {
          _role: Database["kommo"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      internal_function_secret: { Args: never; Returns: string }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      list_workspace_members: {
        Args: { _workspace_id: string }
        Returns: {
          email: string
          full_name: string
          is_owner: boolean
          role: string
          user_id: string
        }[]
      }
      remove_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: undefined
      }
      set_integration_token: {
        Args: { p_integration_id: string; p_token: string }
        Returns: string
      }
      trigger_report_snapshot_all: { Args: never; Returns: undefined }
      trigger_sync_all: { Args: never; Returns: undefined }
      trigger_sync_all_full: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  kommo: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
