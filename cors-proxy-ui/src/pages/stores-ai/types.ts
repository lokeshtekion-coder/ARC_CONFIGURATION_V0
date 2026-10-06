import type { ExtendedStoreRecord } from "../Stores";

export interface LearnedRule {
  id: string;
  rule: string;
  category: "dealer_override" | "assignee_rule" | "general_instruction";
  addedAt: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: string;
}

export interface StoresAIProps {
  isOpen: boolean;
  onClose: () => void;
  records: ExtendedStoreRecord[];
  onToast: (msg: string) => void;
}

export interface StoreEvaluatedState {
  dealerId: string;
  dbaName: string;
  timeline: string;
  diffDays: number;
  fixedOpsStatus: string;
  variableOpsStatus: string;
  fixedAssignee: string;
  varAssignee: string;
  notWorked: string;
  fixedOpsReadyToConfigure: boolean;
  fixedOpsUnassignedAlert: boolean;
  variableOpsReadyToConfigure: boolean;
  variableOpsUnassignedAlert: boolean;
  fixedOpsMissingAttachments: boolean;
  variableBlockers: string[];
  analyticsEscalated: boolean;
}
