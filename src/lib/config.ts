export interface AppConfig {
  qldApiBaseUrl: string;
  qldApiKey: string | undefined;
  storageAccountUrl: string;
  container: string;
  historyContainer: string;
  searchEndpoint: string | undefined;
  openAiEndpoint: string | undefined;
  chatDeployment: string | undefined;
  indexerName: string;
  softDeleteRetentionDays: number;
}

const DEFAULT_QLD_API = 'https://api.jus-checklist.services.qld.gov.au/v1/api/legacy/resources/grants';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}

export function loadConfig(): AppConfig {
  const retention = process.env.SOFT_DELETE_RETENTION_DAYS ?? '30';
  const softDeleteRetentionDays = Number(retention);
  if (!retention.trim() || !Number.isFinite(softDeleteRetentionDays) || softDeleteRetentionDays < 0) {
    throw new Error('SOFT_DELETE_RETENTION_DAYS must be a non-negative number');
  }
  const openAiEndpoint = process.env.FOUNDRY_OPENAI_ENDPOINT || undefined;
  const chatDeployment = process.env.CHAT_DEPLOYMENT || undefined;
  if (!!openAiEndpoint !== !!chatDeployment) {
    throw new Error('FOUNDRY_OPENAI_ENDPOINT and CHAT_DEPLOYMENT must be configured together');
  }
  return {
    qldApiBaseUrl: process.env.QLD_API_BASE_URL ?? DEFAULT_QLD_API,
    qldApiKey: process.env.QLD_API_KEY,
    storageAccountUrl: required('GRANTS_STORAGE_ACCOUNT_URL'),
    container: process.env.GRANTS_CONTAINER ?? 'grants',
    historyContainer: process.env.GRANTS_HISTORY_CONTAINER ?? 'grants-history',
    searchEndpoint: process.env.SEARCH_ENDPOINT,
    openAiEndpoint,
    chatDeployment,
    indexerName: process.env.SEARCH_INDEXER_NAME ?? 'grants-indexer',
    softDeleteRetentionDays,
  };
}
