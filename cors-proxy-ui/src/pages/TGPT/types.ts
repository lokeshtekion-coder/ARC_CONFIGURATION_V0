export type RunState = "idle" | "loading" | "success" | "error" | "warning";

export interface TGPTProps {
  onBack: () => void;
}

export interface TGPTConversation {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
}

export interface TGPTMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  timestamp: string;
  status?: string;
  messageId?: string;
}

export interface GovernanceData {
  budget?: {
    daily_spent?: number;
    daily_remaining?: number;
    daily_limit?: number;
    daily_usage_pct?: number;
    status?: string;
    status_color?: string;
  };
  most_critical_rate_limit?: {
    current_messages?: number;
    max_messages?: number;
    model?: string;
  };
}

export interface UploadedAttachment {
  id?: string;
  filename?: string;
  stored_filename?: string;
  content_type?: string;
  size?: number;
  url?: string;
  name?: string;
  type?: string;
}

export interface RawConversation {
  _id?: string;
  id?: string;
  title?: string;
  name?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  message_count?: number;
  messageCount?: number;
}

export interface RawMessage {
  role: "user" | "assistant";
  content?: string;
  thinking?: string;
  _id?: string;
  created_at?: string;
}