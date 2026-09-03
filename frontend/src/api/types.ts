export interface Trial {
  active: boolean;
  ends_at: string;
  question_daily_limit: number;
}

export interface OrganizationRef {
  organization_id: string;
  name: string;
  slug?: string;
}

export interface User {
  user_id: string;
  email: string;
  display_name: string;
  role: "admin" | "member";
  is_super_admin: boolean;
  organization: OrganizationRef;
  trial: Trial;
}

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}

export interface ChatSummary {
  chat_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
}

export interface IngestionJob {
  job_id: string;
  operation: "index" | "metadata_extraction";
  document_name: string;
  document_type: string | null;
  content_type: string;
  size_bytes: number;
  recommended_gpu_minutes: number;
  state: string;
  stage: string;
  progress: number;
  message: string;
  compute_session_id: string | null;
  result_document_id: string | null;
  chunks_indexed: number;
  tables_indexed: number;
  visuals_indexed: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndexedDocument {
  document_id: string;
  document_name: string;
  document_type: string | null;
  schema_version: number;
  classification_status:
    "confirmed" | "review_required" | "unclassified" | "failed";
  classification_source: "automatic" | "manual";
  classification_confidence: number | null;
  extraction_status: "not_requested" | "completed" | "failed";
  extracted_metadata: Record<string, unknown>;
  content_type: string;
  size_bytes: number;
  chunk_count: number;
  allowed_roles: string[];
  allowed_users: string[];
  created_by: string;
  created_at: string;
}

export interface DocumentTypeSchema {
  key: string;
  label: string;
  fields: string[];
}

export interface IndustrySchema {
  key: string;
  label: string;
  description: string;
  document_types: DocumentTypeSchema[];
}

export interface DashboardDocument {
  document_id: string;
  document_name: string;
  document_type: string | null;
  document_type_label: string;
  industry_key: string | null;
  industry_label: string;
  classification_status:
    "confirmed" | "review_required" | "unclassified" | "failed";
  classification_source: "automatic" | "manual";
  classification_confidence: number | null;
  extraction_status: "not_requested" | "completed" | "failed";
  extracted_metadata: Record<string, unknown>;
  created_at: string;
}

export interface DashboardIndustry {
  key: string;
  label: string;
  document_count: number;
  document_type_count: number;
}

export interface Dashboard {
  total_documents: number;
  classified_documents: number;
  extracted_documents: number;
  review_required_documents: number;
  industries: DashboardIndustry[];
  recent_documents: DashboardDocument[];
}

export interface DashboardDocumentList {
  total: number;
  documents: DashboardDocument[];
}

export interface ComputeSession {
  session_id: string;
  status: string;
  provider: string;
  max_jobs: number;
  max_gpu_minutes: number;
  max_estimated_cost_usd: number | null;
  released_job_count: number;
  gpu_seconds: number;
  estimated_cost_usd: number;
  jobs: IngestionJob[];
}

export interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: "admin" | "member";
  active: boolean;
  is_super_admin?: boolean;
  email_verified?: boolean;
  created_at?: string;
}

export interface PlatformOrganization extends OrganizationRef {
  active: boolean;
  created_at: string;
  user_count: number;
  active_user_count: number;
  document_count: number;
  held_job_count: number;
  users: Member[];
}

export interface ResponseEvaluation {
  correctness: number;
  relevance: number;
  clarity: number;
  overall: number;
  notes: string | null;
  evaluator_user_id: string;
  updated_at: string;
}

export interface ChatResponseReview {
  response_message_id: string;
  chat_id: string;
  chat_title: string;
  organization_id: string;
  organization_name: string;
  user_id: string;
  user_name: string;
  question: string;
  answer: string;
  created_at: string;
  evaluation: ResponseEvaluation | null;
}
