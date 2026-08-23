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
          owner_type: string | null;
          company_name: string | null;
          electricity_meter_number: string | null;
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
          owner_type?: string | null;
          company_name?: string | null;
          electricity_meter_number?: string | null;
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
          owner_type?: string | null;
          company_name?: string | null;
          electricity_meter_number?: string | null;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
