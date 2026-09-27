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
          middle_name: string | null;
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
          middle_name?: string | null;
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
          middle_name?: string | null;
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
          submitted_source: string | null;
          idempotency_key: string | null;
          electricity_meter_id: string | null;
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
          submitted_source?: string | null;
          idempotency_key?: string | null;
          electricity_meter_id?: string | null;
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
          submitted_source?: string | null;
          idempotency_key?: string | null;
          electricity_meter_id?: string | null;
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
          registry_people_id: number | null;
          weight: number | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          poll_id: number;
          option_id: number;
          property_id: number;
          registry_people_id?: number | null;
          weight?: number | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          poll_id?: number;
          option_id?: number;
          property_id?: number;
          registry_people_id?: number | null;
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
          section_code: string | null;
          block_code: string | null;
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
          purpose: string | null;
          ideal_parts_percent: number | null;
          ideal_parts_source: string | null;
          ideal_parts_note: string | null;
          ideal_parts_meeting_ref: string | null;
          owner_user_management_agreement: string | null;
          ownership_type: string | null;
        };
        Insert: {
          id?: number;
          created_at?: string;
          apartment_number?: string;
          floor?: number | null;
          section_code?: string | null;
          block_code?: string | null;
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
          purpose?: string | null;
          ideal_parts_percent?: number | null;
          ideal_parts_source?: string | null;
          ideal_parts_note?: string | null;
          ideal_parts_meeting_ref?: string | null;
          owner_user_management_agreement?: string | null;
          ownership_type?: string | null;
        };
        Update: {
          id?: number;
          created_at?: string;
          apartment_number?: string;
          floor?: number | null;
          section_code?: string | null;
          block_code?: string | null;
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
          purpose?: string | null;
          ideal_parts_percent?: number | null;
          ideal_parts_source?: string | null;
          ideal_parts_note?: string | null;
          ideal_parts_meeting_ref?: string | null;
          owner_user_management_agreement?: string | null;
          ownership_type?: string | null;
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
      staff_work_capabilities: {
        Row: {
          staff_id: number;
          can_self_claim_requests: boolean;
          can_receive_work_orders: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          staff_id: number;
          can_self_claim_requests?: boolean;
          can_receive_work_orders?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          staff_id?: number;
          can_self_claim_requests?: boolean;
          can_receive_work_orders?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      staff_request_category_scope: {
        Row: {
          staff_id: number;
          category: string;
        };
        Insert: {
          staff_id: number;
          category: string;
        };
        Update: {
          staff_id?: number;
          category?: string;
        };
        Relationships: [];
      };
      cleaning_orders: {
        Row: {
          id: string;
          property_id: number;
          service_kind: string;
          status: string;
          preferred_date: string | null;
          time_slot: string;
          note: string | null;
          admin_note: string | null;
          created_by_role: string;
          created_by_email: string;
          work_order_id: string | null;
          confirmed_by: number | null;
          confirmed_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          service_kind: string;
          status?: string;
          preferred_date?: string | null;
          time_slot?: string;
          note?: string | null;
          admin_note?: string | null;
          created_by_role: string;
          created_by_email: string;
          work_order_id?: string | null;
          confirmed_by?: number | null;
          confirmed_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          service_kind?: string;
          status?: string;
          preferred_date?: string | null;
          time_slot?: string;
          note?: string | null;
          admin_note?: string | null;
          created_by_role?: string;
          created_by_email?: string;
          work_order_id?: string | null;
          confirmed_by?: number | null;
          confirmed_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      work_orders: {
        Row: {
          id: string;
          title: string;
          instructions: string | null;
          status: string;
          priority: string;
          assigned_staff_id: number | null;
          scheduled_for: string | null;
          target_property_id: number | null;
          location_description: string | null;
          source_type: string;
          request_id: number | null;
          created_by: string;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          completion_note: string | null;
          idempotency_key: string | null;
          internet_action: string | null;
          internet_subscription_id: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          instructions?: string | null;
          status?: string;
          priority?: string;
          assigned_staff_id?: number | null;
          scheduled_for?: string | null;
          target_property_id?: number | null;
          location_description?: string | null;
          source_type: string;
          request_id?: number | null;
          created_by: string;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
          completion_note?: string | null;
          idempotency_key?: string | null;
          internet_action?: string | null;
          internet_subscription_id?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          instructions?: string | null;
          status?: string;
          priority?: string;
          assigned_staff_id?: number | null;
          scheduled_for?: string | null;
          target_property_id?: number | null;
          location_description?: string | null;
          source_type?: string;
          request_id?: number | null;
          created_by?: string;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
          completion_note?: string | null;
          idempotency_key?: string | null;
          internet_action?: string | null;
          internet_subscription_id?: string | null;
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
      property_guest_accesses: {
        Row: {
          id: string;
          property_id: number;
          email: string;
          relation_type: string;
          valid_from: string;
          valid_until: string | null;
          status: string;
          created_by_email: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          email: string;
          relation_type: string;
          valid_from?: string;
          valid_until?: string | null;
          status?: string;
          created_by_email: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          email?: string;
          relation_type?: string;
          valid_from?: string;
          valid_until?: string | null;
          status?: string;
          created_by_email?: string;
          created_at?: string;
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
          is_taken_to_public_places: boolean | null;
          updated_at?: string;
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
          is_taken_to_public_places?: boolean | null;
          updated_at?: string;
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
          is_taken_to_public_places?: boolean | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      property_registry_people: {
        Row: {
          id: number;
          property_id: number;
          relation_type: string;
          entity_kind: string;
          first_name: string | null;
          middle_name: string | null;
          last_name: string | null;
          entity_name: string | null;
          eik_bulstat: string | null;
          email: string | null;
          registered_at: string | null;
          deregistered_at: string | null;
          lives_on_property: boolean | null;
          note: string | null;
          ownership_share_percent: number | null;
          ideal_parts_percent: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          property_id: number;
          relation_type: string;
          entity_kind?: string;
          first_name?: string | null;
          middle_name?: string | null;
          last_name?: string | null;
          entity_name?: string | null;
          eik_bulstat?: string | null;
          email?: string | null;
          registered_at?: string | null;
          deregistered_at?: string | null;
          lives_on_property?: boolean | null;
          note?: string | null;
          ownership_share_percent?: number | null;
          ideal_parts_percent?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          property_id?: number;
          relation_type?: string;
          entity_kind?: string;
          first_name?: string | null;
          middle_name?: string | null;
          last_name?: string | null;
          entity_name?: string | null;
          eik_bulstat?: string | null;
          email?: string | null;
          registered_at?: string | null;
          deregistered_at?: string | null;
          lives_on_property?: boolean | null;
          note?: string | null;
          ownership_share_percent?: number | null;
          ideal_parts_percent?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      property_absence_periods: {
        Row: {
          id: number;
          property_id: number;
          person_id: number | null;
          from_date: string;
          to_date: string | null;
          note: string | null;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          property_id: number;
          person_id?: number | null;
          from_date: string;
          to_date?: string | null;
          note?: string | null;
          source?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          property_id?: number;
          person_id?: number | null;
          from_date?: string;
          to_date?: string | null;
          note?: string | null;
          source?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      building_settings: {
        Row: {
          id: number;
          support_rate_eur_per_sqm_year: number;
          updated_at: string;
          updated_by: string | null;
          electricity_mode: string | null;
          water_mode: string | null;
        };
        Insert: {
          id?: number;
          support_rate_eur_per_sqm_year?: number;
          updated_at?: string;
          updated_by?: string | null;
          electricity_mode?: string | null;
          water_mode?: string | null;
        };
        Update: {
          id?: number;
          support_rate_eur_per_sqm_year?: number;
          updated_at?: string;
          updated_by?: string | null;
          electricity_mode?: string | null;
          water_mode?: string | null;
        };
        Relationships: [];
      };
      building_modules: {
        Row: {
          module_key: string;
          enabled: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          module_key: string;
          enabled: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          module_key?: string;
          enabled?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      module_catalog: {
        Row: {
          module_key: string;
          default_name: string;
          category: string;
          implemented: boolean;
          sort_order: number;
        };
        Insert: {
          module_key: string;
          default_name: string;
          category: string;
          implemented?: boolean;
          sort_order?: number;
        };
        Update: {
          module_key?: string;
          default_name?: string;
          category?: string;
          implemented?: boolean;
          sort_order?: number;
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
          idempotency_key: string | null;
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
          idempotency_key?: string | null;
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
          idempotency_key?: string | null;
        };
        Relationships: [];
      };
      support_fee_annual_policies: {
        Row: {
          id: string;
          billing_year: number;
          enabled: boolean;
          status: string;
          early_discount_percent: number;
          late_increase_percent: number;
          early_payment_deadline: string;
          created_at: string;
          created_by_email: string | null;
          updated_at: string;
          updated_by_email: string | null;
        };
        Insert: {
          id?: string;
          billing_year: number;
          enabled?: boolean;
          status?: string;
          early_discount_percent?: number;
          late_increase_percent?: number;
          early_payment_deadline: string;
          created_at?: string;
          created_by_email?: string | null;
          updated_at?: string;
          updated_by_email?: string | null;
        };
        Update: {
          id?: string;
          billing_year?: number;
          enabled?: boolean;
          status?: string;
          early_discount_percent?: number;
          late_increase_percent?: number;
          early_payment_deadline?: string;
          created_at?: string;
          created_by_email?: string | null;
          updated_at?: string;
          updated_by_email?: string | null;
        };
        Relationships: [];
      };
      support_fee_assessments: {
        Row: {
          id: string;
          property_id: number;
          billing_year: number;
          policy_id: string | null;
          charge_ledger_id: number | null;
          base_amount: number;
          discount_percent: number;
          increase_percent: number;
          early_amount: number;
          late_amount: number;
          early_deadline_at: string | null;
          pricing_rule: string;
          pricing_reason_code: string | null;
          qualification_status: string;
          qualification_checked_at: string | null;
          available_credit_at_check: number;
          amount_covered_at_check: number;
          dedicated_payment_at_check: number;
          applied_credit_amount: number;
          applied_payment_amount: number;
          final_amount: number;
          remaining_due: number;
          balance_before: number | null;
          balance_after: number | null;
          status: string;
          created_at: string;
          created_by_email: string | null;
          finalized_at: string | null;
          finalized_by_email: string | null;
          correction_reason: string | null;
          correction_at: string | null;
          correction_by_email: string | null;
          tariff_version_id: string | null;
          area_sqm_snapshot: number | null;
          rate_eur_per_sqm_year_snapshot: number | null;
        };
        Insert: {
          id?: string;
          property_id: number;
          billing_year: number;
          policy_id?: string | null;
          charge_ledger_id?: number | null;
          base_amount: number;
          discount_percent?: number;
          increase_percent?: number;
          early_amount: number;
          late_amount: number;
          early_deadline_at?: string | null;
          pricing_rule: string;
          pricing_reason_code?: string | null;
          qualification_status: string;
          qualification_checked_at?: string | null;
          available_credit_at_check?: number;
          amount_covered_at_check?: number;
          dedicated_payment_at_check?: number;
          applied_credit_amount?: number;
          applied_payment_amount?: number;
          final_amount: number;
          remaining_due?: number;
          balance_before?: number | null;
          balance_after?: number | null;
          status?: string;
          created_at?: string;
          created_by_email?: string | null;
          finalized_at?: string | null;
          finalized_by_email?: string | null;
          correction_reason?: string | null;
          correction_at?: string | null;
          correction_by_email?: string | null;
          tariff_version_id?: string | null;
          area_sqm_snapshot?: number | null;
          rate_eur_per_sqm_year_snapshot?: number | null;
        };
        Update: {
          id?: string;
          property_id?: number;
          billing_year?: number;
          policy_id?: string | null;
          charge_ledger_id?: number | null;
          base_amount?: number;
          discount_percent?: number;
          increase_percent?: number;
          early_amount?: number;
          late_amount?: number;
          early_deadline_at?: string | null;
          pricing_rule?: string;
          pricing_reason_code?: string | null;
          qualification_status?: string;
          qualification_checked_at?: string | null;
          available_credit_at_check?: number;
          amount_covered_at_check?: number;
          dedicated_payment_at_check?: number;
          applied_credit_amount?: number;
          applied_payment_amount?: number;
          final_amount?: number;
          remaining_due?: number;
          balance_before?: number | null;
          balance_after?: number | null;
          status?: string;
          created_at?: string;
          created_by_email?: string | null;
          finalized_at?: string | null;
          finalized_by_email?: string | null;
          correction_reason?: string | null;
          correction_at?: string | null;
          correction_by_email?: string | null;
          tariff_version_id?: string | null;
          area_sqm_snapshot?: number | null;
          rate_eur_per_sqm_year_snapshot?: number | null;
        };
        Relationships: [];
      };
      support_fee_allocations: {
        Row: {
          id: string;
          assessment_id: string;
          ledger_entry_id: number | null;
          amount: number;
          allocation_type: string;
          created_at: string;
          created_by_email: string | null;
        };
        Insert: {
          id?: string;
          assessment_id: string;
          ledger_entry_id?: number | null;
          amount: number;
          allocation_type: string;
          created_at?: string;
          created_by_email?: string | null;
        };
        Update: {
          id?: string;
          amount?: number;
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
      electricity_meters: {
        Row: {
          id: string;
          property_id: number;
          meter_number: string;
          initial_day_reading: number;
          initial_night_reading: number;
          installed_at: string;
          retired_at: string | null;
          replacement_reason: string | null;
          assigned_by_email: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          meter_number: string;
          initial_day_reading: number;
          initial_night_reading: number;
          installed_at: string;
          retired_at?: string | null;
          replacement_reason?: string | null;
          assigned_by_email: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          meter_number?: string;
          initial_day_reading?: number;
          initial_night_reading?: number;
          installed_at?: string;
          retired_at?: string | null;
          replacement_reason?: string | null;
          assigned_by_email?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      electricity_tariffs: {
        Row: {
          id: string;
          day_price_eur_per_kwh: number;
          night_price_eur_per_kwh: number;
          valid_from: string;
          note: string | null;
          created_by_email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          day_price_eur_per_kwh: number;
          night_price_eur_per_kwh: number;
          valid_from: string;
          note?: string | null;
          created_by_email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          day_price_eur_per_kwh?: number;
          night_price_eur_per_kwh?: number;
          valid_from?: string;
          note?: string | null;
          created_by_email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      electricity_charges: {
        Row: {
          id: string;
          property_id: number;
          day_reading_id: number;
          night_reading_id: number;
          reading_date: string;
          previous_day: number;
          current_day: number;
          previous_night: number;
          current_night: number;
          tariff_id: string | null;
          tariff_version_id: string | null;
          day_tariff_eur_per_kwh: number;
          night_tariff_eur_per_kwh: number;
          consumption_day: number;
          consumption_night: number;
          day_amount_eur: number;
          night_amount_eur: number;
          total_amount_eur: number;
          recorded_by_email: string;
          idempotency_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          day_reading_id: number;
          night_reading_id: number;
          reading_date: string;
          previous_day: number;
          current_day: number;
          previous_night: number;
          current_night: number;
          tariff_id?: string | null;
          tariff_version_id?: string | null;
          day_tariff_eur_per_kwh: number;
          night_tariff_eur_per_kwh: number;
          recorded_by_email: string;
          idempotency_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          day_reading_id?: number;
          night_reading_id?: number;
          reading_date?: string;
          previous_day?: number;
          current_day?: number;
          previous_night?: number;
          current_night?: number;
          tariff_id?: string | null;
          tariff_version_id?: string | null;
          day_tariff_eur_per_kwh?: number;
          night_tariff_eur_per_kwh?: number;
          recorded_by_email?: string;
          idempotency_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      electricity_ledger: {
        Row: {
          id: string;
          property_id: number;
          charge_id: string | null;
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
          charge_id?: string | null;
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
          charge_id?: string | null;
          kind?: string;
          amount_eur?: number;
          note?: string | null;
          recorded_by_email?: string | null;
          idempotency_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      tariff_catalog: {
        Row: {
          id: string;
          tariff_key: string;
          module_key: string;
          default_name: string;
          unit_code: string;
          currency: string;
          calculation_type: string;
          billing_period: string | null;
          application_basis: string;
          governance_type: string;
          component_keys: string[];
          active: boolean;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          tariff_key: string;
          module_key: string;
          default_name: string;
          unit_code: string;
          currency?: string;
          calculation_type: string;
          billing_period?: string | null;
          application_basis: string;
          governance_type: string;
          component_keys: string[];
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          tariff_key?: string;
          module_key?: string;
          default_name?: string;
          unit_code?: string;
          currency?: string;
          calculation_type?: string;
          billing_period?: string | null;
          application_basis?: string;
          governance_type?: string;
          component_keys?: string[];
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      tariff_versions: {
        Row: {
          id: string;
          tariff_id: string;
          valid_from: string;
          status: string;
          basis_type: string;
          basis_reference: string | null;
          basis_date: string | null;
          basis_note: string;
          decision_id: string | null;
          published_at: string;
          published_by: string | null;
          legacy_author: string | null;
          idempotency_key: string;
          payload_fingerprint: string;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancellation_reason: string | null;
          cancellation_idempotency_key: string | null;
        };
        Insert: {
          id?: string;
          tariff_id: string;
          valid_from: string;
          status: string;
          basis_type: string;
          basis_reference?: string | null;
          basis_date?: string | null;
          basis_note: string;
          decision_id?: string | null;
          published_at?: string;
          published_by?: string | null;
          legacy_author?: string | null;
          idempotency_key: string;
          payload_fingerprint: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancellation_reason?: string | null;
          cancellation_idempotency_key?: string | null;
        };
        Update: {
          id?: string;
          tariff_id?: string;
          valid_from?: string;
          status?: string;
          basis_type?: string;
          basis_reference?: string | null;
          basis_date?: string | null;
          basis_note?: string;
          decision_id?: string | null;
          published_at?: string;
          published_by?: string | null;
          legacy_author?: string | null;
          idempotency_key?: string;
          payload_fingerprint?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancellation_reason?: string | null;
          cancellation_idempotency_key?: string | null;
        };
        Relationships: [];
      };
      tariff_rate_items: {
        Row: {
          version_id: string;
          component_key: string;
          rate: number;
          subject_kind: string;
        };
        Insert: {
          version_id: string;
          component_key: string;
          rate: number;
          subject_kind?: string;
        };
        Update: {
          version_id?: string;
          component_key?: string;
          rate?: number;
          subject_kind?: string;
        };
        Relationships: [];
      };
      tariff_legacy_links: {
        Row: {
          id: string;
          tariff_key: string;
          legacy_source: string;
          legacy_row_id: string | null;
          legacy_key: string | null;
          version_id: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tariff_key: string;
          legacy_source: string;
          legacy_row_id?: string | null;
          legacy_key?: string | null;
          version_id?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tariff_key?: string;
          legacy_source?: string;
          legacy_row_id?: string | null;
          legacy_key?: string | null;
          version_id?: string | null;
          note?: string | null;
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
          tariff_id: string | null;
          tariff_version_id: string | null;
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
          tariff_id?: string | null;
          tariff_version_id?: string | null;
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
          tariff_id?: string | null;
          tariff_version_id?: string | null;
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
      internet_subscriptions: {
        Row: {
          id: string;
          property_id: number;
          status: string;
          period_start: string | null;
          period_end: string | null;
          pending_days: number | null;
          disable_reason: string | null;
          enable_work_order_id: string | null;
          disable_work_order_id: string | null;
          billing_day: number | null;
          billing_anchor_date: string | null;
          next_charge_on: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          status?: string;
          period_start?: string | null;
          period_end?: string | null;
          pending_days?: number | null;
          disable_reason?: string | null;
          enable_work_order_id?: string | null;
          disable_work_order_id?: string | null;
          billing_day?: number | null;
          billing_anchor_date?: string | null;
          next_charge_on?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          status?: string;
          period_start?: string | null;
          period_end?: string | null;
          pending_days?: number | null;
          disable_reason?: string | null;
          enable_work_order_id?: string | null;
          disable_work_order_id?: string | null;
          billing_day?: number | null;
          billing_anchor_date?: string | null;
          next_charge_on?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      internet_ledger: {
        Row: {
          id: string;
          property_id: number;
          kind: string;
          amount_eur: number;
          period_days: number | null;
          tariff_version_id: string | null;
          note: string | null;
          recorded_by_email: string | null;
          idempotency_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: number;
          kind: string;
          amount_eur: number;
          period_days?: number | null;
          tariff_version_id?: string | null;
          note?: string | null;
          recorded_by_email?: string | null;
          idempotency_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: number;
          kind?: string;
          amount_eur?: number;
          period_days?: number | null;
          tariff_version_id?: string | null;
          note?: string | null;
          recorded_by_email?: string | null;
          idempotency_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      building_documents: {
        Row: {
          id: string;
          category: string;
          title: string;
          description: string | null;
          document_date: string | null;
          storage_path: string;
          mime_type: string | null;
          file_size: number | null;
          status: string;
          version: number;
          supersedes_document_id: string | null;
          created_by_email: string | null;
          created_at: string;
          published_at: string | null;
          published_by_email: string | null;
        };
        Insert: {
          id?: string;
          category: string;
          title: string;
          description?: string | null;
          document_date?: string | null;
          storage_path: string;
          mime_type?: string | null;
          file_size?: number | null;
          status?: string;
          version?: number;
          supersedes_document_id?: string | null;
          created_by_email?: string | null;
          created_at?: string;
          published_at?: string | null;
          published_by_email?: string | null;
        };
        Update: {
          id?: string;
          category?: string;
          title?: string;
          description?: string | null;
          document_date?: string | null;
          storage_path?: string;
          mime_type?: string | null;
          file_size?: number | null;
          status?: string;
          version?: number;
          supersedes_document_id?: string | null;
          created_by_email?: string | null;
          created_at?: string;
          published_at?: string | null;
          published_by_email?: string | null;
        };
        Relationships: [];
      };
      general_meetings: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          meeting_date: string;
          meeting_time: string | null;
          location: string | null;
          meeting_mode: string;
          is_urgent: boolean;
          status: string;
          convoked_by: string | null;
          invitation_posted_at: string | null;
          minutes_completed_at: string | null;
          minutes_notice_posted_at: string | null;
          absentee_voting_enabled: boolean;
          absentee_voting_deadline: string | null;
          online_meeting_url: string | null;
          represented_ideal_parts_percent: number | null;
          quorum_stage: string | null;
          signed_document_uploaded: boolean;
          external_registry_ref: string | null;
          created_by_email: string | null;
          created_at: string;
          updated_at: string;
          published_at: string | null;
          published_by_email: string | null;
          cancelled_at: string | null;
          cancelled_by_email: string | null;
          cancellation_reason: string | null;
          reschedule_reason: string | null;
          rescheduled_from_meeting_id: string | null;
          operational_phase: string;
          registration_opened_at: string | null;
          meeting_started_at: string | null;
          meeting_ended_at: string | null;
          meeting_can_proceed: boolean;
          quorum_rule: string;
          quorum_rule_note: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          meeting_date: string;
          meeting_time?: string | null;
          location?: string | null;
          meeting_mode?: string;
          is_urgent?: boolean;
          status?: string;
          convoked_by?: string | null;
          invitation_posted_at?: string | null;
          minutes_completed_at?: string | null;
          minutes_notice_posted_at?: string | null;
          absentee_voting_enabled?: boolean;
          absentee_voting_deadline?: string | null;
          online_meeting_url?: string | null;
          represented_ideal_parts_percent?: number | null;
          quorum_stage?: string | null;
          signed_document_uploaded?: boolean;
          external_registry_ref?: string | null;
          created_by_email?: string | null;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
          published_by_email?: string | null;
          cancelled_at?: string | null;
          cancelled_by_email?: string | null;
          cancellation_reason?: string | null;
          reschedule_reason?: string | null;
          rescheduled_from_meeting_id?: string | null;
          operational_phase?: string;
          registration_opened_at?: string | null;
          meeting_started_at?: string | null;
          meeting_ended_at?: string | null;
          meeting_can_proceed?: boolean;
          quorum_rule?: string;
          quorum_rule_note?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          meeting_date?: string;
          meeting_time?: string | null;
          location?: string | null;
          meeting_mode?: string;
          is_urgent?: boolean;
          status?: string;
          convoked_by?: string | null;
          invitation_posted_at?: string | null;
          minutes_completed_at?: string | null;
          minutes_notice_posted_at?: string | null;
          absentee_voting_enabled?: boolean;
          absentee_voting_deadline?: string | null;
          online_meeting_url?: string | null;
          represented_ideal_parts_percent?: number | null;
          quorum_stage?: string | null;
          signed_document_uploaded?: boolean;
          external_registry_ref?: string | null;
          created_by_email?: string | null;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
          published_by_email?: string | null;
          cancelled_at?: string | null;
          cancelled_by_email?: string | null;
          cancellation_reason?: string | null;
          reschedule_reason?: string | null;
          rescheduled_from_meeting_id?: string | null;
          operational_phase?: string;
          registration_opened_at?: string | null;
          meeting_started_at?: string | null;
          meeting_ended_at?: string | null;
          meeting_can_proceed?: boolean;
          quorum_rule?: string;
          quorum_rule_note?: string | null;
        };
        Relationships: [];
      };
      general_meeting_agenda_items: {
        Row: {
          id: string;
          meeting_id: string;
          position: number;
          title: string;
          description: string | null;
          proposed_decision_text: string | null;
          created_at: string;
          decision_category: string | null;
          majority_rule: string;
          threshold_comparator: string;
          required_percent: number | null;
          denominator_basis: string;
          legal_basis: string | null;
          voting_status: string;
          voting_opened_at: string | null;
          voting_closed_at: string | null;
          for_percent: number | null;
          against_percent: number | null;
          abstain_percent: number | null;
          computed_threshold_status: string | null;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          position: number;
          title: string;
          description?: string | null;
          proposed_decision_text?: string | null;
          created_at?: string;
          majority_rule?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          position?: number;
          title?: string;
          description?: string | null;
          proposed_decision_text?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      general_meeting_decisions: {
        Row: {
          id: string;
          meeting_id: string;
          agenda_item_id: string | null;
          decision_number: string;
          title: string;
          decision_text: string;
          protocol_result: string;
          execution_status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          agenda_item_id?: string | null;
          decision_number: string;
          title: string;
          decision_text: string;
          protocol_result: string;
          execution_status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          agenda_item_id?: string | null;
          decision_number?: string;
          title?: string;
          decision_text?: string;
          protocol_result?: string;
          execution_status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      general_meeting_participants: {
        Row: {
          id: string;
          meeting_id: string;
          property_id: number;
          participant_name: string;
          representation_type: string;
          representative_name: string | null;
          property_number_snapshot: string | null;
          ideal_parts_percent_snapshot: number | null;
          attendance_mode: string;
          proxy_document_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          property_id: number;
          participant_name: string;
          representation_type: string;
          representative_name?: string | null;
          property_number_snapshot?: string | null;
          ideal_parts_percent_snapshot?: number | null;
          attendance_mode: string;
          proxy_document_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          property_id?: number;
          participant_name?: string;
          representation_type?: string;
          representative_name?: string | null;
          property_number_snapshot?: string | null;
          ideal_parts_percent_snapshot?: number | null;
          attendance_mode?: string;
          proxy_document_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      general_meeting_votes: {
        Row: {
          id: string;
          meeting_id: string;
          decision_id: string;
          property_id: number;
          registry_people_id: number | null;
          participant_id: string | null;
          vote: string;
          ideal_parts_percent_snapshot: number | null;
          vote_method: string;
          vote_source: string | null;
          recorded_at: string;
          recorded_by_email: string | null;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          decision_id: string;
          property_id: number;
          registry_people_id?: number | null;
          participant_id?: string | null;
          vote: string;
          ideal_parts_percent_snapshot?: number | null;
          vote_method: string;
          vote_source?: string | null;
          recorded_at?: string;
          recorded_by_email?: string | null;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          decision_id?: string;
          property_id?: number;
          registry_people_id?: number | null;
          participant_id?: string | null;
          vote?: string;
          ideal_parts_percent_snapshot?: number | null;
          vote_method?: string;
          vote_source?: string | null;
          recorded_at?: string;
          recorded_by_email?: string | null;
        };
        Relationships: [];
      };
      general_meeting_files: {
        Row: {
          id: string;
          meeting_id: string;
          document_id: string;
          file_type: string;
          title: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          document_id: string;
          file_type: string;
          title?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          document_id?: string;
          file_type?: string;
          title?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_staff_salaries: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: number;
          salary_eur: number | null;
        }[];
      };
      publish_building_document: {
        Args: { p_document_id: string };
        Returns: Database['public']['Tables']['building_documents']['Row'];
      };
      archive_building_document: {
        Args: { p_document_id: string };
        Returns: Database['public']['Tables']['building_documents']['Row'];
      };
      publish_general_meeting: {
        Args: { p_meeting_id: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      publish_general_meeting_minutes: {
        Args: { p_meeting_id: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      refresh_meeting_represented_parts: {
        Args: { p_meeting_id: string };
        Returns: number;
      };
      cancel_general_meeting: {
        Args: { p_meeting_id: string; p_reason: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      reschedule_general_meeting: {
        Args: {
          p_meeting_id: string;
          p_meeting_date: string;
          p_meeting_time: string | null;
          p_location: string | null;
          p_meeting_mode: string;
          p_reason: string;
        };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      calculate_general_meeting_quorum: {
        Args: { p_meeting_id: string };
        Returns: Json;
      };
      record_general_meeting_quorum_check: {
        Args: { p_meeting_id: string; p_review_note?: string | null };
        Returns: Json;
      };
      open_general_meeting_registration: {
        Args: { p_meeting_id: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      advance_general_meeting_quorum_stage: {
        Args: { p_meeting_id: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      declare_general_meeting_attendance: {
        Args: { p_meeting_id: string; p_property_id: number; p_attendance_mode: string };
        Returns: Database['public']['Tables']['general_meeting_participants']['Row'];
      };
      confirm_general_meeting_attendance: {
        Args: { p_participant_id: string };
        Returns: Database['public']['Tables']['general_meeting_participants']['Row'];
      };
      reject_general_meeting_attendance: {
        Args: { p_participant_id: string; p_reason: string };
        Returns: Database['public']['Tables']['general_meeting_participants']['Row'];
      };
      register_general_meeting_participant: {
        Args: {
          p_meeting_id: string;
          p_property_id: number;
          p_attendance_mode: string;
          p_representation_type: string;
          p_representative_name?: string | null;
          p_confirm?: boolean;
        };
        Returns: Database['public']['Tables']['general_meeting_participants']['Row'];
      };
      mark_general_meeting_participant_left: {
        Args: { p_participant_id: string; p_reason?: string | null };
        Returns: Database['public']['Tables']['general_meeting_participants']['Row'];
      };
      start_general_meeting: {
        Args: { p_meeting_id: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      open_general_meeting_vote: {
        Args: { p_agenda_item_id: string };
        Returns: Database['public']['Tables']['general_meeting_agenda_items']['Row'];
      };
      cast_general_meeting_vote: {
        Args: { p_agenda_item_id: string; p_property_id: number; p_vote: string };
        Returns: Database['public']['Tables']['general_meeting_votes']['Row'];
      };
      record_general_meeting_vote: {
        Args: { p_agenda_item_id: string; p_property_id: number; p_vote: string };
        Returns: Database['public']['Tables']['general_meeting_votes']['Row'];
      };
      close_general_meeting_vote: {
        Args: { p_agenda_item_id: string };
        Returns: Database['public']['Tables']['general_meeting_agenda_items']['Row'];
      };
      set_general_meeting_protocol_result: {
        Args: { p_decision_id: string; p_protocol_result: string; p_override_reason?: string | null };
        Returns: Database['public']['Tables']['general_meeting_decisions']['Row'];
      };
      finish_general_meeting: {
        Args: { p_meeting_id: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      mark_general_meeting_held: {
        Args: { p_meeting_id: string };
        Returns: Database['public']['Tables']['general_meetings']['Row'];
      };
      set_general_meeting_online_url: {
        Args: { p_meeting_id: string; p_url: string };
        Returns: undefined;
      };
      get_general_meeting_online_join_url: {
        Args: { p_meeting_id: string };
        Returns: string;
      };
      can_manage_building_governance: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      update_apartment_guest: {
        Args: {
          p_guest_id: number;
          p_first_name: string;
          p_last_name: string;
          p_birth_year?: number | null;
          p_is_child?: boolean;
          p_is_permanent?: boolean;
          p_check_in?: string | null;
          p_check_out?: string | null;
        };
        Returns: Database['public']['Tables']['apartment_guests']['Row'];
      };
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
      list_staff_property_directory: {
        Args: Record<string, never>;
        Returns: Database['public']['Tables']['properties']['Row'][];
      };
      read_building_settings: {
        Args: Record<string, never>;
        Returns: {
          id: number;
          electricity_mode: string | null;
          water_mode: string | null;
          updated_at: string;
          updated_by: string | null;
          support_rate_eur_per_sqm_year: number | null;
        }[];
      };
      get_building_modules: {
        Args: Record<string, never>;
        Returns: {
          module_key: string;
          enabled: boolean;
        }[];
      };
      get_building_modules_v2: {
        Args: Record<string, never>;
        Returns: {
          module_key: string;
          enabled: boolean;
          default_name: string;
          category: string;
          sort_order: number;
          implemented: boolean;
        }[];
      };
      set_building_module_enabled: {
        Args: { p_module_key: string; p_enabled: boolean };
        Returns: {
          module_key: string;
          enabled: boolean;
        }[];
      };
      current_staff_id: {
        Args: Record<string, never>;
        Returns: number;
      };
      list_tariffs: {
        Args: {
          p_module_key?: string | null;
          p_active_only?: boolean;
          p_limit?: number;
        };
        Returns: {
          tariff_id: string;
          tariff_key: string;
          module_key: string;
          default_name: string;
          unit_code: string;
          currency: string;
          calculation_type: string;
          billing_period: string | null;
          application_basis: string;
          governance_type: string;
          component_keys: string[];
          active: boolean;
          current_version_id: string | null;
          current_valid_from: string | null;
          current_rates: Record<string, number> | null;
          current_basis_type: string | null;
          current_basis_note: string | null;
          current_basis_date: string | null;
          current_published_at: string | null;
          current_legacy_author: string | null;
          nearest_future_version_id: string | null;
          nearest_future_valid_from: string | null;
          nearest_future_rates: Record<string, number> | null;
          nearest_future_basis_type: string | null;
          nearest_future_basis_note: string | null;
          nearest_future_basis_date: string | null;
          nearest_future_published_at: string | null;
        }[];
      };
      list_tariff_history: {
        Args: {
          p_tariff_id: string;
          p_status?: string | null;
          p_valid_from_from?: string | null;
          p_valid_from_to?: string | null;
          p_cursor_valid_from?: string | null;
          p_cursor_id?: string | null;
          p_limit?: number;
        };
        Returns: {
          version_id: string;
          tariff_id: string;
          valid_from: string;
          status: string;
          rates: Record<string, number> | null;
          basis_type: string;
          basis_reference: string | null;
          basis_date: string | null;
          basis_note: string;
          decision_id: string | null;
          published_at: string;
          published_by: string | null;
          legacy_author: string | null;
          cancelled_at: string | null;
          cancellation_reason: string | null;
        }[];
      };
      publish_tariff_version: {
        Args: {
          p_tariff_id: string;
          p_rates: Record<string, number> | {
            natural?: Record<string, number>;
            legal?: Record<string, number>;
          };
          p_basis_type: string;
          p_basis_note: string;
          p_idempotency_key: string;
          p_application_year?: number | null;
          p_valid_from?: string | null;
          p_basis_reference?: string | null;
          p_basis_date?: string | null;
          p_decision_id?: string | null;
        };
        Returns: {
          version_id: string;
          tariff_id: string;
          valid_from: string;
          status: string;
          rates: Record<string, number> | null;
          published_at: string;
        }[];
      };
      cancel_future_tariff_version: {
        Args: {
          p_version_id: string;
          p_reason: string;
          p_cancellation_idempotency_key: string;
        };
        Returns: {
          version_id: string;
          status: string;
          cancelled_at: string | null;
        }[];
      };
      get_applicable_utility_tariff: {
        Args: {
          p_tariff_key: string;
          p_on_date?: string | null;
        };
        Returns: {
          tariff_version_id: string;
          tariff_key: string;
          valid_from: string;
          rates: Record<string, number> | null;
        }[];
      };
      get_applicable_support_tariff: {
        Args: {
          p_billing_year?: number | null;
        };
        Returns: {
          tariff_version_id: string;
          valid_from: string;
          rate_eur_per_sqm_year: number;
          billing_year: number;
        }[];
      };
      support_fee_base_amount_for_year: {
        Args: {
          p_property_id: number;
          p_billing_year: number;
        };
        Returns: number;
      };
      list_work_orders_admin: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          title: string;
          instructions: string | null;
          status: string;
          priority: string;
          assigned_staff_id: number | null;
          assignee_name: string | null;
          assignee_role: string | null;
          scheduled_for: string | null;
          target_property_id: number | null;
          apartment_number: string | null;
          location_description: string | null;
          source_type: string;
          request_id: number | null;
          request_subject: string | null;
          requester_name: string | null;
          requester_phone: string | null;
          internet_action: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          completion_note: string | null;
        }[];
      };
      list_my_work_orders: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          title: string;
          instructions: string | null;
          status: string;
          priority: string;
          scheduled_for: string | null;
          apartment_number: string | null;
          location_description: string | null;
          request_id: number | null;
          request_subject: string | null;
          requester_name: string | null;
          requester_phone: string | null;
          completed_at: string | null;
          completion_note: string | null;
          created_at: string;
        }[];
      };
      list_claimable_requests: {
        Args: Record<string, never>;
        Returns: {
          request_id: number;
          subject: string | null;
          description: string | null;
          category: string | null;
          priority: string | null;
          owner_name: string | null;
          owner_phone: string | null;
          property_id: number | null;
          apartment_number: string | null;
          created_at: string;
        }[];
      };
      claim_request_as_work_order: {
        Args: { p_request_id: number };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      get_request_work_order_context: {
        Args: { p_request_id: number };
        Returns: {
          request_id: number;
          subject: string | null;
          description: string | null;
          category: string | null;
          priority: string | null;
          status: string | null;
          owner_name: string | null;
          owner_phone: string | null;
          property_id: number | null;
          apartment_number: string | null;
          created_at: string;
          work_priority: string;
        }[];
      };
      get_staff_work_profile: {
        Args: { p_staff_id: number };
        Returns: {
          staff_id: number;
          can_self_claim_requests: boolean;
          can_receive_work_orders: boolean;
          categories: string[];
        }[];
      };
      set_staff_work_profile: {
        Args: {
          p_staff_id: number;
          p_can_self_claim_requests: boolean;
          p_can_receive_work_orders: boolean;
          p_categories: string[];
        };
        Returns: undefined;
      };
      get_my_work_claim_profile: {
        Args: Record<string, never>;
        Returns: {
          staff_id: number;
          can_self_claim_requests: boolean;
          can_receive_work_orders: boolean;
          can_see_my_tasks: boolean;
          categories: string[];
        }[];
      };
      list_work_order_assignees: {
        Args: Record<string, never>;
        Returns: {
          id: number;
          name: string;
          role: string;
        }[];
      };
      create_work_order: {
        Args: {
          p_title: string;
          p_instructions?: string | null;
          p_priority?: string;
          p_assigned_staff_id?: number | null;
          p_scheduled_for?: string | null;
          p_target_property_id?: number | null;
          p_location_description?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      create_work_order_from_request: {
        Args: {
          p_request_id: number;
          p_title?: string | null;
          p_instructions?: string | null;
          p_priority?: string;
          p_assigned_staff_id?: number | null;
          p_scheduled_for?: string | null;
          p_location_description?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      assign_work_order: {
        Args: { p_work_order_id: string; p_assigned_staff_id: number | null };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      cancel_work_order: {
        Args: { p_work_order_id: string };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      start_work_order: {
        Args: { p_work_order_id: string };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      return_request_to_work: {
        Args: { p_request_id: number };
        Returns: Database['public']['Tables']['requests']['Row'];
      };
      list_request_work_orders: {
        Args: { p_request_id: number };
        Returns: {
          id: string;
          title: string;
          status: string;
          assigned_staff_id: number | null;
          assignee_name: string | null;
          completed_at: string | null;
          completion_note: string | null;
          created_at: string;
        }[];
      };
      complete_work_order: {
        Args: { p_work_order_id: string; p_completion_note?: string | null };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      set_utility_information_mode: {
        Args: { p_utility: string; p_mode: string };
        Returns: {
          id: number;
          electricity_mode: string | null;
          water_mode: string | null;
          updated_at: string;
          updated_by: string | null;
        }[];
      };
      set_support_rate_eur_per_sqm_year: {
        Args: { p_rate: number };
        Returns: {
          id: number;
          support_rate_eur_per_sqm_year: number;
          updated_at: string;
          updated_by: string | null;
        }[];
      };
      set_poll_lifecycle: {
        Args: { p_poll_id: number; p_close: boolean };
        Returns: Database['public']['Tables']['polls']['Row'];
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
        Args: {
          p_property_id: number;
          p_amount: number;
          p_note: string | null;
          p_idempotency_key: string;
        };
        Returns: Json;
      };
      charge_support_fee: {
        Args: { p_property_id: number; p_period: string };
        Returns: Json;
      };
      charge_support_fee_bulk: {
        Args: { p_period: string };
        Returns: Json;
      };
      upsert_support_fee_annual_policy: {
        Args: {
          p_billing_year: number;
          p_enabled: boolean;
          p_early_discount_percent: number;
          p_late_increase_percent: number;
          p_early_payment_deadline: string | null;
        };
        Returns: Database['public']['Tables']['support_fee_annual_policies']['Row'];
      };
      publish_support_fee_annual_policy: {
        Args: { p_billing_year: number };
        Returns: Database['public']['Tables']['support_fee_annual_policies']['Row'];
      };
      close_support_fee_annual_policy: {
        Args: { p_billing_year: number };
        Returns: Database['public']['Tables']['support_fee_annual_policies']['Row'];
      };
      preview_support_fee_year: {
        Args: { p_property_id: number; p_billing_year: number };
        Returns: Json;
      };
      finalize_support_fee_assessment: {
        Args: { p_property_id: number; p_billing_year: number };
        Returns: Json;
      };
      finalize_support_fee_year: {
        Args: { p_billing_year: number };
        Returns: Json;
      };
      record_support_fee_assessment_correction: {
        Args: { p_assessment_id: string; p_amount: number; p_reason: string };
        Returns: Json;
      };
      record_support_payment_for_year: {
        Args: {
          p_property_id: number;
          p_amount: number;
          p_billing_year: number;
          p_note: string | null;
          p_idempotency_key: string;
        };
        Returns: Json;
      };
      support_fee_base_amount: {
        Args: { p_property_id: number };
        Returns: number;
      };
      support_fee_early_deadline: {
        Args: { p_billing_year: number };
        Returns: string;
      };
      support_fee_year_start: {
        Args: { p_billing_year: number };
        Returns: string;
      };
      assign_water_meter: {
        Args: {
          p_property_id: number;
          p_meter_number: string;
          p_initial_reading: number;
          p_installed_at: string;
        };
        Returns: Database['public']['Tables']['water_meters']['Row'][];
      };
      assign_electricity_meter: {
        Args: {
          p_property_id: number;
          p_meter_number: string;
          p_initial_day_reading: number;
          p_initial_night_reading: number;
          p_installed_at: string;
        };
        Returns: Database['public']['Tables']['electricity_meters']['Row'][];
      };
      replace_electricity_meter: {
        Args: {
          p_property_id: number;
          p_new_meter_number: string;
          p_initial_day_reading: number;
          p_initial_night_reading: number;
          p_installed_at: string;
          p_replacement_reason: string;
        };
        Returns: Database['public']['Tables']['electricity_meters']['Row'][];
      };
      replace_water_meter: {
        Args: {
          p_property_id: number;
          p_new_meter_number: string;
          p_new_initial_reading: number;
          p_reason: string;
          p_installed_at: string;
        };
        Returns: Database['public']['Tables']['water_meters']['Row'][];
      };
      set_water_tariff: {
        Args: {
          p_price_eur_per_m3: number;
          p_valid_from: string;
          p_note: string | null;
        };
        Returns: Database['public']['Tables']['water_tariffs']['Row'][];
      };
      record_water_payment: {
        Args: {
          p_property_id: number;
          p_amount_eur: number;
          p_note: string | null;
          p_idempotency_key: string;
        };
        Returns: {
          ledger_id: string;
          property_id: number;
          amount_eur: number;
          note: string | null;
          created_at: string;
        }[];
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
      submit_electricity_reading: {
        Args: {
          p_property_id: number;
          p_day_reading: number;
          p_night_reading: number;
          p_reading_date: string;
          p_idempotency_key: string;
        };
        Returns: {
          day_reading_id: number;
          night_reading_id: number;
          property_id: number;
          reading_date: string;
          previous_day: number;
          current_day: number;
          consumption_day: number;
          previous_night: number;
          current_night: number;
          consumption_night: number;
          submitted_source: string;
          day_tariff_eur_per_kwh: number;
          night_tariff_eur_per_kwh: number;
          day_amount_eur: number;
          night_amount_eur: number;
          total_amount_eur: number;
          charge_created: boolean;
        }[];
      };
      set_electricity_tariff: {
        Args: {
          p_day_price_eur_per_kwh: number;
          p_night_price_eur_per_kwh: number;
          p_valid_from: string;
          p_note: string | null;
        };
        Returns: Database['public']['Tables']['electricity_tariffs']['Row'][];
      };
      record_electricity_payment: {
        Args: {
          p_property_id: number;
          p_amount_eur: number;
          p_note: string | null;
          p_idempotency_key: string;
        };
        Returns: {
          ledger_id: string;
          property_id: number;
          amount_eur: number;
          note: string | null;
          created_at: string;
        }[];
      };
      get_electricity_balance: {
        Args: { p_property_id: number };
        Returns: {
          charged_eur: number;
          paid_eur: number;
          adjustments_debit_eur: number;
          adjustments_credit_eur: number;
          balance_eur: number;
          debt_eur: number;
          overpayment_eur: number;
        }[];
      };
      create_capital_repair_assessment: {
        Args: {
          p_title: string;
          p_description: string | null;
          p_decision_date: string;
          p_due_date: string | null;
        };
        Returns: Database['public']['Tables']['capital_repair_assessments']['Row'][];
      };
      charge_capital_repair_year_bulk: {
        Args: {
          p_billing_year: number;
          p_note?: string | null;
        };
        Returns: Json;
      };
      charge_capital_repair_bulk: {
        Args: {
          p_assessment_id: string;
          p_billing_year: number;
          p_note: string | null;
        };
        Returns: Json;
      };
      get_capital_repair_fund_totals: {
        Args: Record<string, never>;
        Returns: {
          charged_eur: number;
          paid_eur: number;
          balance_eur: number;
          apartments_with_debt: number;
        }[];
      };
      ensure_capital_repair_year_assessment: {
        Args: {
          p_billing_year: number;
        };
        Returns: string;
      };
      charge_capital_repair: {
        Args: {
          p_property_id: number;
          p_assessment_id: string;
          p_billing_year: number;
          p_note: string | null;
          p_idempotency_key: string;
        };
        Returns: {
          ledger_id: string;
          property_id: number;
          assessment_id: string;
          amount_eur: number;
          note: string | null;
          created_at: string;
        }[];
      };
      get_applicable_capital_tariff: {
        Args: {
          p_billing_year?: number | null;
        };
        Returns: {
          tariff_version_id: string;
          valid_from: string;
          amount_eur: number;
          billing_year: number;
        }[];
      };
      get_applicable_internet_tariff: {
        Args: { p_on_date?: string | null };
        Returns: {
          tariff_version_id: string;
          tariff_key: string;
          valid_from: string;
          rates: Json;
        }[];
      };
      compute_internet_amount: {
        Args: { p_days: number; p_on_date?: string | null };
        Returns: {
          days: number;
          month_cycles: number;
          remainder_days: number;
          day_rate_eur: number;
          month_rate_eur: number;
          amount_eur: number;
          tariff_version_id: string;
        }[];
      };
      compute_internet_monthly_amount: {
        Args: { p_on_date?: string | null };
        Returns: {
          month_rate_eur: number;
          amount_eur: number;
          tariff_version_id: string;
        }[];
      };
      request_internet_connect: {
        Args: {
          p_property_id: number;
          p_idempotency_key?: string | null;
        };
        Returns: Database['public']['Tables']['internet_subscriptions']['Row'];
      };
      request_internet_extend: {
        Args: {
          p_property_id: number;
          p_idempotency_key?: string | null;
        };
        Returns: Database['public']['Tables']['internet_subscriptions']['Row'];
      };
      cancel_internet_connect_request: {
        Args: { p_property_id: number };
        Returns: Database['public']['Tables']['internet_subscriptions']['Row'];
      };
      request_internet_disconnect: {
        Args: { p_property_id: number };
        Returns: Database['public']['Tables']['internet_subscriptions']['Row'];
      };
      admin_internet_disconnect_debt: {
        Args: { p_property_id: number };
        Returns: Database['public']['Tables']['internet_subscriptions']['Row'];
      };
      record_internet_payment: {
        Args: {
          p_property_id: number;
          p_amount_eur: number;
          p_note: string | null;
          p_idempotency_key: string;
        };
        Returns: {
          ledger_id: string;
          property_id: number;
          amount_eur: number;
          note: string | null;
          created_at: string;
        }[];
      };
      get_internet_balance: {
        Args: { p_property_id: number };
        Returns: {
          charged_eur: number;
          paid_eur: number;
          adjustments_debit_eur: number;
          adjustments_credit_eur: number;
          balance_eur: number;
        }[];
      };
      get_internet_fund_totals: {
        Args: Record<string, never>;
        Returns: {
          active_count: number;
          inactive_count: number;
          pending_enable_count: number;
          pending_disable_count: number;
          charged_eur: number;
          paid_eur: number;
          balance_eur: number;
        }[];
      };
      get_property_service_lock: {
        Args: { p_property_id: number };
        Returns: {
          active: boolean;
          reason_code: string | null;
          locked_at: string | null;
          admin_note: string | null;
          scopes: string[];
        }[];
      };
      list_property_service_locks: {
        Args: Record<string, never>;
        Returns: {
          lock_id: string;
          property_id: number;
          apartment_number: string;
          owner_name: string | null;
          active: boolean;
          reason_code: string;
          admin_note: string | null;
          locked_at: string;
          locked_by_email: string | null;
          scopes: string[];
        }[];
      };
      admin_lock_property_services: {
        Args: {
          p_property_id: number;
          p_note?: string | null;
          p_scopes?: string[] | null;
        };
        Returns: {
          id: string;
          property_id: number;
          active: boolean;
          reason_code: string;
          admin_note: string | null;
          locked_by: string;
          locked_at: string;
          unlocked_by: string | null;
          unlocked_at: string | null;
          created_at: string;
          scopes: string[];
        };
      };
      list_property_service_lock_events: {
        Args: { p_property_id?: number | null; p_limit?: number };
        Returns: {
          event_id: string;
          property_id: number;
          apartment_number: string;
          owner_name: string | null;
          lock_id: string | null;
          event_type: string;
          reason_code: string | null;
          admin_note: string | null;
          actor_email: string | null;
          created_at: string;
          scopes: string[];
        }[];
      };
      admin_unlock_property_services: {
        Args: { p_property_id: number };
        Returns: {
          id: string;
          property_id: number;
          active: boolean;
          reason_code: string;
          admin_note: string | null;
          locked_by: string;
          locked_at: string;
          unlocked_by: string | null;
          unlocked_at: string | null;
          created_at: string;
        };
      };
      list_claimable_system_work_orders: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          title: string;
          instructions: string | null;
          status: string;
          priority: string;
          apartment_number: string | null;
          internet_action: string | null;
          created_at: string;
        }[];
      };
      claim_system_work_order: {
        Args: { p_work_order_id: string };
        Returns: Database['public']['Tables']['work_orders']['Row'];
      };
      list_internet_work_orders: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          title: string;
          instructions: string | null;
          status: string;
          priority: string;
          internet_action: string | null;
          assigned_staff_id: number | null;
          assignee_name: string | null;
          apartment_number: string | null;
          property_id: number | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          completion_note: string | null;
        }[];
      };
      get_internet_open_task_counts: {
        Args: Record<string, never>;
        Returns: {
          claimable_count: number;
          my_open_count: number;
          open_total: number;
        }[];
      };
      record_capital_repair_payment: {
        Args: {
          p_property_id: number;
          p_amount_eur: number;
          p_note: string | null;
          p_idempotency_key: string;
        };
        Returns: {
          ledger_id: string;
          property_id: number;
          amount_eur: number;
          note: string | null;
          created_at: string;
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
      submit_property_book_change: {
        Args: { p_property_id: number; p_message: string; p_payload?: Json };
        Returns: number;
      };
      property_ideal_parts_overview: {
        Args: Record<string, never>;
        Returns: {
          property_count: number;
          filled_count: number;
          null_count: number;
          sum_percent: number | null;
          needs_review: boolean;
        }[];
      };
      can_read_property_book: {
        Args: { p_property_id: number };
        Returns: boolean;
      };
      admin_upsert_staff: {
        Args: {
          p_id: number | null;
          p_name: string;
          p_role: string;
          p_email: string | null;
          p_phone: string | null;
          p_active: boolean;
          p_salary_eur: number | null;
        };
        Returns: number;
      };
      owner_create_cleaning_order: {
        Args: {
          p_property_id: number;
          p_service_kind: string;
          p_preferred_date?: string | null;
          p_time_slot?: string;
          p_note?: string | null;
        };
        Returns: Database['public']['Tables']['cleaning_orders']['Row'];
      };
      owner_list_my_cleaning_orders: {
        Args: { p_property_id: number };
        Returns: Database['public']['Tables']['cleaning_orders']['Row'][];
      };
      owner_cancel_cleaning_order: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['cleaning_orders']['Row'];
      };
      admin_list_cleaning_orders: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          property_id: number;
          apartment_number: string;
          service_kind: string;
          status: string;
          preferred_date: string | null;
          time_slot: string;
          note: string | null;
          admin_note: string | null;
          created_by_role: string;
          created_by_email: string;
          work_order_id: string | null;
          confirmed_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          created_at: string;
        }[];
      };
      admin_create_cleaning_order: {
        Args: {
          p_property_id: number;
          p_service_kind: string;
          p_preferred_date?: string | null;
          p_time_slot?: string;
          p_note?: string | null;
        };
        Returns: Database['public']['Tables']['cleaning_orders']['Row'];
      };
      admin_set_cleaning_order_status: {
        Args: {
          p_order_id: string;
          p_status: string;
          p_admin_note?: string | null;
          p_create_work_order?: boolean;
        };
        Returns: Database['public']['Tables']['cleaning_orders']['Row'];
      };
      admin_list_security_posts: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          active: boolean;
          sort_order: number;
          created_at: string;
        }[];
      };
      list_active_security_posts: {
        Args: Record<string, never>;
        Returns: { id: string; name: string; sort_order: number }[];
      };
      admin_create_security_post: {
        Args: { p_name: string; p_sort_order?: number };
        Returns: {
          id: string;
          name: string;
          active: boolean;
          sort_order: number;
          created_at: string;
        };
      };
      admin_update_security_post: {
        Args: {
          p_post_id: string;
          p_name?: string | null;
          p_active?: boolean | null;
          p_sort_order?: number | null;
        };
        Returns: {
          id: string;
          name: string;
          active: boolean;
          sort_order: number;
          created_at: string;
        };
      };
      owner_create_security_request: {
        Args: {
          p_property_id: number;
          p_kind: string;
          p_post_id?: string | null;
          p_guest_id?: number | null;
          p_guest_name?: string | null;
          p_expected_at?: string | null;
          p_courier_name?: string | null;
          p_delivery_note?: string | null;
          p_handover_item?: string | null;
          p_note?: string | null;
          p_delivery_mode?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      admin_create_security_request: {
        Args: {
          p_property_id: number;
          p_kind: string;
          p_post_id?: string | null;
          p_guest_id?: number | null;
          p_guest_name?: string | null;
          p_expected_at?: string | null;
          p_courier_name?: string | null;
          p_delivery_note?: string | null;
          p_handover_item?: string | null;
          p_note?: string | null;
          p_delivery_mode?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      owner_list_my_security_requests: {
        Args: { p_property_id?: number | null };
        Returns: Record<string, unknown>[];
      };
      owner_cancel_security_request: {
        Args: { p_request_id: string };
        Returns: Record<string, unknown>;
      };
      admin_list_security_requests: {
        Args: { p_status?: string | null; p_limit?: number };
        Returns: {
          id: string;
          property_id: number;
          apartment_number: string;
          post_id: string;
          post_name: string;
          kind: string;
          status: string;
          delivery_mode: string | null;
          created_by_role: string;
          created_by_email: string;
          guest_name: string | null;
          expected_at: string | null;
          courier_name: string | null;
          delivery_note: string | null;
          handover_item: string | null;
          note: string | null;
          accepted_at: string | null;
          handed_over_at: string | null;
          completion_mode: string | null;
          created_at: string;
        }[];
      };
      guard_open_shift: {
        Args: { p_post_id: string };
        Returns: Record<string, unknown>;
      };
      guard_close_shift: {
        Args: Record<string, never>;
        Returns: Record<string, unknown>;
      };
      guard_my_shift: {
        Args: Record<string, never>;
        Returns: {
          shift_id: string;
          post_id: string;
          post_name: string;
          started_at: string;
        }[];
      };
      guard_list_post_queue: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          property_id: number;
          apartment_number: string;
          post_id: string;
          kind: string;
          status: string;
          delivery_mode: string | null;
          guest_name: string | null;
          expected_at: string | null;
          courier_name: string | null;
          delivery_note: string | null;
          handover_item: string | null;
          note: string | null;
          created_at: string;
          accepted_at: string | null;
          accepted_photo_path: string | null;
          handed_over_photo_path: string | null;
          completion_mode: string | null;
        }[];
      };
      guard_mark_seen: {
        Args: { p_request_id: string };
        Returns: Record<string, unknown>;
      };
      guard_receive_at_post: {
        Args: { p_request_id: string; p_photo_path?: string | null };
        Returns: Record<string, unknown>;
      };
      guard_complete_request: {
        Args: {
          p_request_id: string;
          p_photo_path?: string | null;
          p_completion_mode?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      guard_accept_request: {
        Args: { p_request_id: string; p_photo_path?: string | null };
        Returns: Record<string, unknown>;
      };
      guard_handover_request: {
        Args: {
          p_request_id: string;
          p_photo_path?: string | null;
          p_completion_mode?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      admin_list_property_book: {
        Args: { p_limit?: number };
        Returns: {
          property_id: number;
          apartment_number: string;
          floor: number | null;
          section_code: string | null;
          block_code: string | null;
          purpose: string | null;
          area_sqm: number | null;
          ideal_parts_percent: number | null;
          ownership_type: string | null;
          owner_count: number;
          book_complete: boolean;
          validation: Record<string, unknown>;
        }[];
      };
      admin_get_property_book: {
        Args: { p_property_id: number };
        Returns: Record<string, unknown>;
      };
      admin_upsert_property_book_object: {
        Args: {
          p_property_id: number;
          p_purpose: string;
          p_area_sqm: number;
          p_ideal_parts_percent: number;
          p_ownership_type: string;
          p_ideal_parts_source?: string | null;
          p_apartment_number?: number | null;
          p_floor?: number | null;
          p_ideal_parts_note?: string | null;
          p_ideal_parts_meeting_ref?: string | null;
          p_section_code?: string | null;
          p_block_code?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      admin_replace_property_book_owners: {
        Args: { p_property_id: number; p_owners: unknown };
        Returns: Record<string, unknown>;
      };
      admin_list_property_change_log: {
        Args: { p_property_id: number; p_limit?: number };
        Returns: {
          id: string;
          property_id: number;
          changed_at: string;
          changed_by_email: string | null;
          changed_by_uid: string | null;
          source: string;
          entity: string;
          action: string;
          changes: Record<string, unknown>;
          note: string | null;
        }[];
      };
      admin_import_property_book: {
        Args: {
          p_objects: unknown;
          p_owners: unknown;
          p_dry_run?: boolean;
        };
        Returns: Record<string, unknown>;
      };
      property_book_is_complete: {
        Args: { p_property_id: number };
        Returns: boolean;
      };
      property_book_validate: {
        Args: { p_property_id: number };
        Returns: Record<string, unknown>;
      };
      list_my_owned_properties: {
        Args: Record<string, never>;
        Returns: Database['public']['Tables']['properties']['Row'][];
      };
      admin_create_property_invite: {
        Args: { p_property_id: number; p_email: string };
        Returns: Record<string, unknown>;
      };
      admin_mass_create_property_invites: {
        Args: {
          p_floor?: number | null;
          p_section_code?: string | null;
          p_block_code?: string | null;
          p_dry_run?: boolean;
          p_skip_existing?: boolean;
        };
        Returns: Record<string, unknown>;
      };
      admin_revoke_property_invite: {
        Args: { p_invite_id: string };
        Returns: Record<string, unknown>;
      };
      admin_list_property_invites: {
        Args: { p_property_id: number };
        Returns: Record<string, unknown>[];
      };
      accept_property_invite: {
        Args: { p_token: string; p_mark_accepted?: boolean };
        Returns: Record<string, unknown>;
      };
      list_my_guest_properties: {
        Args: Record<string, never>;
        Returns: Database['public']['Tables']['properties']['Row'][];
      };
      owner_list_guest_accesses: {
        Args: { p_property_id: number };
        Returns: Database['public']['Tables']['property_guest_accesses']['Row'][];
      };
      owner_create_guest_access: {
        Args: {
          p_property_id: number;
          p_email: string;
          p_relation_type: string;
          p_valid_from?: string;
          p_valid_until?: string | null;
        };
        Returns: Database['public']['Tables']['property_guest_accesses']['Row'];
      };
      owner_revoke_guest_access: {
        Args: { p_access_id: string };
        Returns: Database['public']['Tables']['property_guest_accesses']['Row'];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
