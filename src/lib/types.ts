/** Raw shapes returned by the QLD Grants Finder API. */
export interface RawDetail {
  title: string;
  sections: { type: string; data: string }[];
}

export interface RawService {
  id: string;
  name: string;
  tags: string[];
  business_activities: string[];
  parent_answer_ids: string[];
  location: string;
  details: Record<string, RawDetail>;
}

export type RawServices = Record<string, RawService>;

export interface RawDimension {
  id: string;
  title: string;
  description?: string;
  order?: string;
  response_type?: string;
  funnels: { key: string; name: string }[];
}

export const DIMENSIONS = {
  applicationType: 'application_type',
  category: 'category',
  clientGroup: 'client_group_1',
  fundingType: 'funding_type',
  businessActivity: 'business_activities',
} as const;

export type DimensionKey = keyof typeof DIMENSIONS;
export type Dimensions = Record<DimensionKey, RawDimension>;

/** The normalized document stored in Blob Storage and indexed by Azure AI Search. */
export interface GrantDocument {
  id: string;
  source: string;
  jurisdictions: string[];
  title: string;
  programName: string;
  roundName: string | null;
  summary: string | null;
  eligibility: string | null;
  howToApply: string | null;
  successNotification: string | null;
  url: string | null;
  deliveredBy: string | null;
  issuingAgency: string | null;
  status: string | null;
  isOpen: boolean;
  openingDate: string | null;
  closingDate: string | null;
  amount: number | null;
  financialYearBudget: string | null;
  assistanceType: string | null;
  applicantTypes: string[];
  categories: string[];
  clientGroups: string[];
  fundingTypes: string[];
  businessActivities: string[];
  tagIds: string[];
  sourceIds: string[];
  contentHash: string;
  lastChangedAt: string | null;
  /** Public-dataset provenance and qualitative values that must not be coerced into numbers or dates. */
  sourceDatasetUrl?: string | null;
  sourceUpdatedAt?: string | null;
  licenseUrl?: string | null;
  openingDateText?: string | null;
  closingDateText?: string | null;
  amountText?: string | null;
  additionalBudgetInformation?: string | null;
}

/** Current staging representation; revision is bookkeeping, not part of normalized content hashes. */
export interface StoredGrantDocument extends GrantDocument {
  revision: number;
}
