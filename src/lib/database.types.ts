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
        };
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
        };
        Insert: {
          id?: number;
          created_at?: string;
          property_id: number;
          sender: string;
          message: string;
          read_by_uk?: boolean;
          read_by_owner?: boolean;
        };
        Update: {
          id?: number;
          created_at?: string;
          property_id?: number;
          sender?: string;
          message?: string;
          read_by_uk?: boolean;
          read_by_owner?: boolean;
        };
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
        };
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
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
