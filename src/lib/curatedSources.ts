/**
 * Official program pages that the QLD Grants Finder feed and business.gov.au do not list (or list thinly).
 * Each entry is fetched on every sync and normalized into a GrantDocument. Only public, robots-permitted
 * government pages belong here; add an entry when a gap is confirmed against both existing sources.
 */
export interface CuratedSource {
  url: string;
  issuingAgency: string;
  assistanceType: 'Grant' | 'Loan' | 'Rebate' | null;
  categories: string[];
  applicantTypes: string[];
  /** Overrides the default document source label. */
  sourceLabel?: string;
}

export const CURATED_SOURCES: CuratedSource[] = [
  {
    url: 'https://www.qra.qld.gov.au/resilient-homes-fund',
    issuingAgency: 'Queensland Reconstruction Authority',
    assistanceType: 'Grant',
    categories: ['Disaster recovery', 'Housing'],
    applicantTypes: ['Individual'],
  },
  {
    url: 'https://www.qld.gov.au/housing/home-energy-savings/supercharged-solar-for-renters',
    issuingAgency: 'Queensland Government',
    assistanceType: 'Rebate',
    categories: ['Energy', 'Housing'],
    applicantTypes: ['Individual'],
  },
  {
    url: 'https://www.qrida.qld.gov.au/program/first-start-loan',
    issuingAgency: 'Queensland Rural and Industry Development Authority',
    assistanceType: 'Loan',
    categories: ['Agriculture', 'Business'],
    applicantTypes: ['Business'],
  },
  {
    url: 'https://www.qrida.qld.gov.au/program/sustainability-loan',
    issuingAgency: 'Queensland Rural and Industry Development Authority',
    assistanceType: 'Loan',
    categories: ['Agriculture', 'Business'],
    applicantTypes: ['Business'],
  },
  {
    url: 'https://www.qrida.qld.gov.au/program/drought-preparedness-grants',
    issuingAgency: 'Queensland Rural and Industry Development Authority',
    assistanceType: 'Grant',
    categories: ['Agriculture', 'Drought'],
    applicantTypes: ['Business'],
  },
  {
    url: 'https://www.qrida.qld.gov.au/program/disaster-assistance-loans',
    issuingAgency: 'Queensland Rural and Industry Development Authority',
    assistanceType: 'Loan',
    categories: ['Disaster recovery', 'Agriculture'],
    applicantTypes: ['Business', 'Non-profit'],
  },
  {
    url: 'https://www.qrida.qld.gov.au/program/remote-communities-freight-assistance-scheme',
    issuingAgency: 'Queensland Rural and Industry Development Authority',
    assistanceType: 'Grant',
    categories: ['Regional', 'Freight'],
    applicantTypes: ['Individual', 'Business'],
  },
];
