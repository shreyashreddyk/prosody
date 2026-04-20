export type SourceKind = "document" | "notes" | "image" | "link";
export type SourceProcessingStatus = "pending" | "processing" | "ready" | "failed";

export interface Source {
  id: string;
  conversationId: string;
  kind: SourceKind;
  filename: string;
  mimeType: string;
  storageBucket?: string;
  storagePath?: string;
  sizeBytes?: number;
  processingStatus: SourceProcessingStatus;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}
