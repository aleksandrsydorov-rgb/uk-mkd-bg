export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      announcements: {
        Row: {
          id: number;
          created_at: string;
          title: string | null;
          body: string | null;
          created_by: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          title?: string | null;
          body?: string | null;
          created_by?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          title?: string | null;
          body?: string | null;
          created_by?: string | null;
        };
        Relationships: [];
      };
      apartment_guests: {
        Row: {
          id: number;
          created_at?: string;
          property_id: number;
          first_name: string;
          last_name: string;
          birth_year: number | null;
          is_child: boolean;
          check_in: string | null;
          check_out: string | null;
          is_permanent: boolean | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id: number;
          first_name: string;
          last_name: string;
          birth_year?: number | null;
          is_child?: boolean;
          check_in?: string | null;
          check_out?: string | null;
          is_permanent?: boolean | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number;
          first_name?: string;
          last_name?: string;
          birth_year?: number | null;
          is_child?: boolean;
          check_in?: string | null;
          check_out?: string | null;
          is_permanent?: boolean | null;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: number;
          created_at: string;
          property_id: number;
          sender: string;
          message: string;
          read_by_uk: boolean;
          read_by_owner: boolean;
          photo_url: string | null;
          file_name: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id: number;
          sender: string;
          message: string;
          read_by_uk?: boolean;
          read_by_owner?: boolean;
          photo_url?: string | null;
          file_name?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number;
          sender?: string;
          message?: string;
          read_by_uk?: boolean;
          read_by_owner?: boolean;
          photo_url?: string | null;
          file_name?: string | null;
        };
        Relationships: [];
      };
      meter_readings: {
        Row: {
          id: number;
          created_at: string;
          property_id: number | null;
          meter_type: string | null;
          value: number | null;
          reading_date: string | null;
          submitted_by: string | null;
          meter_serial_number: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id?: number | null;
          meter_type?: string | null;
          value?: number | null;
          reading_date?: string | null;
          submitted_by?: string | null;
          meter_serial_number?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number | null;
          meter_type?: string | null;
          value?: number | null;
          reading_date?: string | null;
          submitted_by?: string | null;
          meter_serial_number?: string | null;
        };
        Relationships: [];
      };
      n525_commands: {
        Row: {
          id: number;
          created_at: string;
          status: string | null;
          user_id: string | null;
          command_text: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          status?: string | null;
          user_id?: string | null;
          command_text?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          status?: string | null;
          user_id?: string | null;
          command_text?: string | null;
        };
        Relationships: [];
      };
      owner_transfers: {
        Row: {
          id: number;
          created_at: string;
          property_id: number;
          from_owner_name: string | null;
          from_owner_email: string | null;
          from_owner_phone: string | null;
          to_owner_name: string;
          to_owner_email: string;
          to_owner_phone: string | null;
          note: string | null;
          status: string;
          decided_at: string | null;
          decided_by: string | null;
          reject_reason: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id: number;
          from_owner_name?: string | null;
          from_owner_email?: string | null;
          from_owner_phone?: string | null;
          to_owner_name: string;
          to_owner_email: string;
          to_owner_phone?: string | null;
          note?: string | null;
          status?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          reject_reason?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number;
          from_owner_name?: string | null;
          from_owner_email?: string | null;
          from_owner_phone?: string | null;
          to_owner_name?: string;
          to_owner_email?: string;
          to_owner_phone?: string | null;
          note?: string | null;
          status?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          reject_reason?: string | null;
        };
        Relationships: [];
      };
      poll_options: {
        Row: {
          id: number;
          poll_id: number;
          label: string;
          sort_order: number;
        };
        Insert: {
          id?: number;
          poll_id: number;
          label: string;
          sort_order?: number;
        };
        Update: {
          id?: number;
          poll_id?: number;
          label?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      poll_suggestions: {
        Row: {
          id: number;
          created_at: string;
          property_id: number;
          category: string;
          title: string;
          body: string | null;
          status: string;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id: number;
          category?: string;
          title: string;
          body?: string | null;
          status?: string;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number;
          category?: string;
          title?: string;
          body?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      poll_vote_history: {
        Row: {
          id: number;
          created_at: string;
          poll_id: number;
          option_id: number;
          property_id: number;
          weight: number | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          poll_id: number;
          option_id: number;
          property_id: number;
          weight?: number | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          poll_id?: number;
          option_id?: number;
          property_id?: number;
          weight?: number | null;
        };
        Relationships: [];
      };
      poll_votes: {
        Row: {
          id: number;
          created_at: string;
          poll_id: number;
          option_id: number;
          property_id: number;
          weight: number | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          poll_id: number;
          option_id: number;
          property_id: number;
          weight?: number | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          poll_id?: number;
          option_id?: number;
          property_id?: number;
          weight?: number | null;
        };
        Relationships: [];
      };
      polls: {
        Row: {
          id: number;
          created_at: string;
          title: string;
          body: string | null;
          category: string;
          status: string;
          deadline: string | null;
          created_by: string | null;
          photo_url: string | null;
          budget_eur: number | null;
          voting_starts: string | null;
          result: string;
          result_option_id: number | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          title: string;
          body?: string | null;
          category?: string;
          status?: string;
          deadline?: string | null;
          created_by?: string | null;
          photo_url?: string | null;
          budget_eur?: number | null;
          voting_starts?: string | null;
          result?: string;
          result_option_id?: number | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          title?: string;
          body?: string | null;
          category?: string;
          status?: string;
          deadline?: string | null;
          created_by?: string | null;
          photo_url?: string | null;
          budget_eur?: number | null;
          voting_starts?: string | null;
          result?: string;
          result_option_id?: number | null;
        };
        Relationships: [];
      };
      properties: {
        Row: {
          id: number;
          created_at: string;
          apartment_number: string;
          floor: number | null;
          area_sqm: number | null;
          status: string | null;
          owner_name: string | null;
          owner_phone: string | null;
          owner_email: string | null;
          debt: number | null;
          overpayment: number | null;
          electricity_meter_number: string | null;
          occupancy_status: string | null;
          pet_info: string | null;
          owner_type: string | null;
          company_name: string | null;
          occupant_kind: string | null;
          occupant_name: string | null;
          occupant_phone: string | null;
          occupant_email: string | null;
          occupant_until: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          apartment_number?: string;
          floor?: number | null;
          area_sqm?: number | null;
          status?: string | null;
          owner_name?: string | null;
          owner_phone?: string | null;
          owner_email?: string | null;
          debt?: number | null;
          overpayment?: number | null;
          electricity_meter_number?: string | null;
          occupancy_status?: string | null;
          pet_info?: string | null;
          owner_type?: string | null;
          company_name?: string | null;
          occupant_kind?: string | null;
          occupant_name?: string | null;
          occupant_phone?: string | null;
          occupant_email?: string | null;
          occupant_until?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          apartment_number?: string;
          floor?: number | null;
          area_sqm?: number | null;
          status?: string | null;
          owner_name?: string | null;
          owner_phone?: string | null;
          owner_email?: string | null;
          debt?: number | null;
          overpayment?: number | null;
          electricity_meter_number?: string | null;
          occupancy_status?: string | null;
          pet_info?: string | null;
          owner_type?: string | null;
          company_name?: string | null;
          occupant_kind?: string | null;
          occupant_name?: string | null;
          occupant_phone?: string | null;
          occupant_email?: string | null;
          occupant_until?: string | null;
        };
        Relationships: [];
      };
      requests: {
        Row: {
          id: number;
          created_at: string;
          property_id: number | null;
          subject: string | null;
          description: string | null;
          status: string | null;
          priority: string | null;
          owner_name: string | null;
          owner_phone: string | null;
          category: string | null;
          photo_url: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id?: number | null;
          subject?: string | null;
          description?: string | null;
          status?: string | null;
          priority?: string | null;
          owner_name?: string | null;
          owner_phone?: string | null;
          category?: string | null;
          photo_url?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number | null;
          subject?: string | null;
          description?: string | null;
          status?: string | null;
          priority?: string | null;
          owner_name?: string | null;
          owner_phone?: string | null;
          category?: string | null;
          photo_url?: string | null;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          id: number;
          created_at: string;
          name: string;
          email: string | null;
          phone: string | null;
          role: string;
          salary_eur: number | null;
          active: boolean | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          name: string;
          email?: string | null;
          phone?: string | null;
          role: string;
          salary_eur?: number | null;
          active?: boolean | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          name?: string;
          email?: string | null;
          phone?: string | null;
          role?: string;
          salary_eur?: number | null;
          active?: boolean | null;
        };
        Relationships: [];
      };
      uk_expenses: {
        Row: {
          id: number;
          created_at: string;
          expense_date: string;
          amount: number;
          title: string | null;
          created_by: string | null;
          status: string | null;
          photo_urls: string[] | null;
          approved_by: string | null;
          approved_at: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          expense_date: string;
          amount: number;
          title?: string | null;
          created_by?: string | null;
          status?: string | null;
          photo_urls?: string[] | null;
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          expense_date?: string;
          amount?: number;
          title?: string | null;
          created_by?: string | null;
          status?: string | null;
          photo_urls?: string[] | null;
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Relationships: [];
      };
      apartment_pets: {
        Row: {
          id: number;
          created_at: string;
          property_id: number;
          species: string;
          name: string | null;
          chip_no: string | null;
          passport_no: string | null;
          notes: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id: number;
          species?: string;
          name?: string | null;
          chip_no?: string | null;
          passport_no?: string | null;
          notes?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number;
          species?: string;
          name?: string | null;
          chip_no?: string | null;
          passport_no?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      building_settings: {
        Row: {
          id: number;
          support_rate_eur_per_sqm_year: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          support_rate_eur_per_sqm_year?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: number;
          support_rate_eur_per_sqm_year?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      support_fee_ledger: {
        Row: {
          id: number;
          created_at: string;
          property_id: number;
          kind: string;
          amount: number;
          period: string | null;
          note: string | null;
          recorded_by: string | null;
          debt_after: number | null;
          overpayment_after: number | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id: number;
          kind: string;
          amount: number;
          period?: string | null;
          note?: string | null;
          recorded_by?: string | null;
          debt_after?: number | null;
          overpayment_after?: number | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number;
          kind?: string;
          amount?: number;
          period?: string | null;
          note?: string | null;
          recorded_by?: string | null;
          debt_after?: number | null;
          overpayment_after?: number | null;
        };
        Relationships: [];
      };
      water_meters: {
        Row: {
          id: string;
          property_id: number;
          meter_number: string;
          initial_reading: number;
          installed_at: string;
          retired_at: string | null;
          replacement_reason: string | null;
          assigned_by_email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          meter_number: string;
          initial_reading: number;
          installed_at?: string;
          retired_at?: string | null;
          replacement_reason?: string | null;
          assigned_by_email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          meter_number?: string;
          initial_reading?: number;
          installed_at?: string;
          retired_at?: string | null;
          replacement_reason?: string | null;
          assigned_by_email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      water_tariffs: {
        Row: {
          id: string;
          price_eur_per_m3: number;
          valid_from: string;
          note: string | null;
          created_by_email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          price_eur_per_m3: number;
          valid_from: string;
          note?: string | null;
          created_by_email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          price_eur_per_m3?: number;
          valid_from?: string;
          note?: string | null;
          created_by_email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      water_readings: {
        Row: {
          id: string;
          property_id: number;
          meter_id: string;
          reading_date: string;
          previous_value: number;
          current_value: number;
          tariff_id: string;
          tariff_eur_per_m3: number;
          consumption_m3: number;
          charge_amount_eur: number;
          submitted_by_email: string | null;
          submitted_via: string;
          idempotency_key: string;
          status: string;
          reversed_at: string | null;
          reversed_by_email: string | null;
          reversal_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          meter_id: string;
          reading_date: string;
          previous_value: number;
          current_value: number;
          tariff_id: string;
          tariff_eur_per_m3: number;
          submitted_by_email?: string | null;
          submitted_via: string;
          idempotency_key: string;
          status?: string;
          reversed_at?: string | null;
          reversed_by_email?: string | null;
          reversal_reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          meter_id?: string;
          reading_date?: string;
          previous_value?: number;
          current_value?: number;
          tariff_id?: string;
          tariff_eur_per_m3?: number;
          submitted_by_email?: string | null;
          submitted_via?: string;
          idempotency_key?: string;
          status?: string;
          reversed_at?: string | null;
          reversed_by_email?: string | null;
          reversal_reason?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      water_ledger: {
        Row: {
          id: string;
          property_id: number;
          reading_id: string | null;
          kind: string;
          amount_eur: number;
          note: string | null;
          recorded_by_email: string | null;
          idempotency_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          reading_id?: string | null;
          kind: string;
          amount_eur: number;
          note?: string | null;
          recorded_by_email?: string | null;
          idempotency_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          reading_id?: string | null;
          kind?: string;
          amount_eur?: number;
          note?: string | null;
          recorded_by_email?: string | null;
          idempotency_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      capital_repair_assessments: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          decision_date: string | null;
          due_date: string | null;
          status: string;
          created_by_email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          decision_date?: string | null;
          due_date?: string | null;
          status?: string;
          created_by_email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          decision_date?: string | null;
          due_date?: string | null;
          status?: string;
          created_by_email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      capital_repair_ledger: {
        Row: {
          id: string;
          property_id: number;
          assessment_id: string | null;
          kind: string;
          amount_eur: number;
          note: string | null;
          recorded_by_email: string | null;
          idempotency_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          assessment_id?: string | null;
          kind: string;
          amount_eur: number;
          note?: string | null;
          recorded_by_email?: string | null;
          idempotency_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          assessment_id?: string | null;
          kind?: string;
          amount_eur?: number;
          note?: string | null;
          recorded_by_email?: string | null;
          idempotency_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      cast_poll_vote: {
        Args: { p_poll_id: number; p_option_id: number };
        Returns: {
          poll_id: number;
          status: string;
          result: string | null;
          result_option_id: number | null;
          winner_option_id: number | null;
          winner_weight: number;
          total_building_weight: number;
          accepted: boolean;
        }[];
      };
      get_poll_tallies: {
        Args: Record<string, never>;
        Returns: {
          poll_id: number;
          option_id: number;
          option_weight: number;
          apartment_count: number;
          total_building_weight: number;
          percentage: number;
        }[];
      };
      can_manage_support_fees: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      record_support_payment: {
        Args: { p_property_id: number; p_amount: number; p_note: string | null };
        Returns: Json;
      };
      charge_support_fee: {
        Args: { p_property_id: number; p_period: string };
        Returns: Json;
      };
      submit_water_reading: {
        Args: {
          p_property_id: number;
          p_current_value: number;
          p_reading_date: string;
          p_idempotency_key: string;
        };
        Returns: {
          reading_id: string;
          property_id: number;
          meter_id: string;
          meter_number: string;
          reading_date: string;
          previous_value: number;
          current_value: number;
          consumption_m3: number;
          tariff_eur_per_m3: number;
          charge_amount_eur: number;
          charge_created: boolean;
        }[];
      };
      get_water_balance: {
        Args: { p_property_id: number };
        Returns: {
          charged_eur: number;
          paid_eur: number;
          adjustments_debit_eur: number;
          adjustments_credit_eur: number;
          balance_eur: number;
        }[];
      };
      get_capital_repair_balance: {
        Args: { p_property_id: number };
        Returns: {
          charged_eur: number;
          paid_eur: number;
          adjustments_debit_eur: number;
          adjustments_credit_eur: number;
          balance_eur: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
