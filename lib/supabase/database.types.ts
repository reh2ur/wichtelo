export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          actor_email: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_email: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target_id: string;
          target_type: string;
        };
        Update: {
          action?: string;
          actor_email?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [];
      };
      assignment_lookups: {
        Row: {
          actor_profile_id: string | null;
          group_id: string;
          id: string;
          looked_up_at: string;
          target_membership_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          actor_profile_id?: string | null;
          group_id: string;
          id?: string;
          looked_up_at?: string;
          target_membership_id?: string | null;
        };
        Update: {
          actor_profile_id?: string | null;
          group_id?: string;
          id?: string;
          looked_up_at?: string;
          target_membership_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_lookups_actor_profile_id_fkey";
            columns: ["actor_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_lookups_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_lookups_target_membership_id_fkey";
            columns: ["target_membership_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
        ];
      };
      assignments: {
        Row: {
          created_at: string;
          giver_id: string;
          group_id: string;
          id: string;
          receiver_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          giver_id: string;
          group_id: string;
          id?: string;
          receiver_id: string;
        };
        Update: {
          created_at?: string;
          giver_id?: string;
          group_id?: string;
          id?: string;
          receiver_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignments_giver_same_group_fkey";
            columns: ["giver_id", "group_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id", "group_id"];
          },
          {
            foreignKeyName: "assignments_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignments_receiver_same_group_fkey";
            columns: ["receiver_id", "group_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id", "group_id"];
          },
        ];
      };
      draw_mail_failures: {
        Row: {
          draw_version: number;
          failed: number;
          group_id: string;
          total: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          draw_version: number;
          failed: number;
          group_id: string;
          total: number;
          updated_at?: string;
        };
        Update: {
          draw_version?: number;
          failed?: number;
          group_id?: string;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "draw_mail_failures_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: true;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      exclusions: {
        Row: {
          group_id: string;
          id: string;
          member_a: string;
          member_b: string;
        };
        ComputedFields: never;
        Insert: {
          group_id: string;
          id?: string;
          member_a: string;
          member_b: string;
        };
        Update: {
          group_id?: string;
          id?: string;
          member_a?: string;
          member_b?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exclusions_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusions_member_a_same_group_fkey";
            columns: ["member_a", "group_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id", "group_id"];
          },
          {
            foreignKeyName: "exclusions_member_b_same_group_fkey";
            columns: ["member_b", "group_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["id", "group_id"];
          },
        ];
      };
      groups: {
        Row: {
          budget_hint: string | null;
          created_at: string;
          created_by: string | null;
          draw_version: number;
          id: string;
          name: string;
          note: string | null;
          slug: string;
          state: Database["public"]["Enums"]["group_state"];
          year: number;
        };
        ComputedFields: never;
        Insert: {
          budget_hint?: string | null;
          created_at?: string;
          created_by?: string | null;
          draw_version?: number;
          id?: string;
          name: string;
          note?: string | null;
          slug: string;
          state?: Database["public"]["Enums"]["group_state"];
          year?: number;
        };
        Update: {
          budget_hint?: string | null;
          created_at?: string;
          created_by?: string | null;
          draw_version?: number;
          id?: string;
          name?: string;
          note?: string | null;
          slug?: string;
          state?: Database["public"]["Enums"]["group_state"];
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invite_tokens: {
        Row: {
          created_at: string;
          group_id: string;
          id: string;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          group_id: string;
          id?: string;
          token?: string;
        };
        Update: {
          created_at?: string;
          group_id?: string;
          id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invite_tokens_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: true;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          first_name_snapshot: string | null;
          group_id: string;
          id: string;
          joined_at: string;
          last_name_snapshot: string | null;
          name_snapshot: string;
          profile_id: string | null;
          role: Database["public"]["Enums"]["member_role"];
        };
        ComputedFields: never;
        Insert: {
          first_name_snapshot?: string | null;
          group_id: string;
          id?: string;
          joined_at?: string;
          last_name_snapshot?: string | null;
          name_snapshot: string;
          profile_id?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
        };
        Update: {
          first_name_snapshot?: string | null;
          group_id?: string;
          id?: string;
          joined_at?: string;
          last_name_snapshot?: string | null;
          name_snapshot?: string;
          profile_id?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
        };
        Relationships: [
          {
            foreignKeyName: "memberships_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          first_name: string;
          id: string;
          last_name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          first_name: string;
          id: string;
          last_name: string;
        };
        Update: {
          created_at?: string;
          first_name?: string;
          id?: string;
          last_name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_group: {
        Args: {
          p_budget_hint: string;
          p_name: string;
          p_note: string;
          p_slugs: string[];
          p_year: number;
        };
        Returns: {
          group_id: string;
          invite_token: string;
          slug: string;
        }[];
      };
      demote_admin: {
        Args: { p_group_id: string; p_membership_id: string };
        Returns: string;
      };
      ghost_drawn_memberships: {
        Args: { p_profile_id: string };
        Returns: number;
      };
      is_admin: { Args: { p_group_id: string }; Returns: boolean };
      is_member: { Args: { p_group_id: string }; Returns: boolean };
      perform_draw: {
        Args: {
          p_expected_state: Database["public"]["Enums"]["group_state"];
          p_expected_version: number;
          p_group_id: string;
          p_pairs: Json;
        };
        Returns: string;
      };
      record_draw_mail_result: {
        Args: {
          p_draw_version: number;
          p_failed: number;
          p_group_id: string;
          p_total: number;
        };
        Returns: undefined;
      };
      remove_membership: {
        Args: {
          p_allow_drawn?: boolean;
          p_enforce_last_admin?: boolean;
          p_group_id: string;
          p_membership_id: string;
        };
        Returns: string;
      };
      reopen_group: { Args: { p_group_id: string }; Returns: string };
    };
    Enums: {
      group_state: "open" | "drawn";
      member_role: "participant" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      group_state: ["open", "drawn"],
      member_role: ["participant", "admin"],
    },
  },
} as const;
