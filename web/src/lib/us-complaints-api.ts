/**
 * Client for POST /api/complaints/us (audit 80+ D11; round 2 page
 * /cant-pay/us-letters). Its own module so lib/api.ts (grandfathered in
 * scripts/size_budget.json, may only shrink) doesn't grow.
 */
import { postWithFieldErrors, type ComplaintMilestone } from './api';

export type UsComplaintKind = 'fcba_billing_error' | 'respa_notice_of_error';

export interface UsComplaintRequest {
  kind: UsComplaintKind;
  /** FCBA only: the first statement that showed the error. */
  statement_on?: string;
  sent_on?: string;
  received_on?: string;
  acknowledged_on?: string;
  resolved_on?: string;
  extended?: boolean;
  as_of?: string;
}

export interface UsComplaintLetter {
  kind: UsComplaintKind;
  send_to: string;
  subject: string;
  paragraphs: string[];
  how_to_send: string[];
  if_no_answer: string[];
  sources: string[];
  draft_notice: string;
  text: string;
}

export interface UsComplaintTimeline {
  market: string;
  stage: string;
  milestones: ComplaintMilestone[];
  next_action: string;
  days_left: number | null;
  escalation_opens: string | null;
  escalation_deadline: string | null;
  notes: string[];
}

export interface UsComplaintResponse {
  letter: UsComplaintLetter;
  timeline: UsComplaintTimeline | null;
}

/** D11: US card billing error (FCBA) or mortgage notice of error (RESPA). Placeholders only. */
export function complaintUs(req: UsComplaintRequest): Promise<UsComplaintResponse> {
  return postWithFieldErrors<UsComplaintResponse>('/api/complaints/us', req);
}
