import type { Campus, Channel } from "./food";

export type StudentSubmissionKind = "correction" | "new-vendor" | "new-dish" | "outdated" | "closed";
export type StudentSubmissionStatus = "pending" | "reviewed" | "applied" | "rejected";

export interface SubmissionAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface StudentSubmission {
  id: string;
  kind: StudentSubmissionKind;
  campus: Campus;
  channel: Channel;
  supportedChannels?: Channel[];
  vendorId?: string;
  vendorName: string;
  itemId?: string;
  itemName?: string;
  area: string;
  floor?: string;
  windowNo?: string;
  suggestedDish?: string;
  suggestedPrice?: number;
  suggestedTags: string;
  note: string;
  contact?: string;
  attachments?: SubmissionAttachment[];
  attachmentCount?: number;
  createdAt: string;
  status: StudentSubmissionStatus;
}
