export type SourceKind = "document" | "notes" | "image" | "link";
export type SourceProcessingStatus = "pending" | "processing" | "ready" | "failed";

export interface Source {
  id: string;
  conversationId: string;
  kind: SourceKind;
  filename: string;
  mimeType: string;
  storagePath?: string;
  processingStatus: SourceProcessingStatus;
}
