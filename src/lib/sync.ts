import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import type { AppConfig } from './config.js';
import { fetchSnapshot } from './qldClient.js';
import { SearchRestClient } from './searchClient.js';
import { syncGrantsToBlob, type BlobSyncStats } from './blobStore.js';
import { buildGrantDocuments } from './transform.js';
import { fetchBusinessGrants } from './businessClient.js';
import { normalizeBusinessGrants } from './businessGrants.js';
import { fetchCuratedGrants } from './curatedGrants.js';
import { fetchBusinessQldPages, urlKey } from './businessQldDiscovery.js';
import { fetchSmartyGrants } from './smartyGrants.js';
import { extractGrantFields, FoundryChatClient } from './extractGrantFields.js';
import { withSyncLease } from './syncLease.js';

export interface SyncSummary {
  fetched: number;
  duplicatesRemoved: number;
  documents: number;
  open: number;
  blob: BlobSyncStats;
  indexer: 'started' | 'alreadyRunning' | 'notConfigured';
  durationMs: number;
}

export async function runSync(
  config: AppConfig,
  log: (message: string) => void = console.log,
): Promise<SyncSummary> {
  const started = Date.now();
  const now = new Date();
  const credential = new DefaultAzureCredential();
  const storage = new BlobServiceClient(config.storageAccountUrl, credential);
  const container = storage.getContainerClient(config.container);
  return withSyncLease(container, async (signal) => {
    const snapshot = await fetchSnapshot({
      baseUrl: config.qldApiBaseUrl,
      ...(config.qldApiKey && { apiKey: config.qldApiKey }),
      signal,
    });
    const qld = buildGrantDocuments(snapshot, now);
    const business = normalizeBusinessGrants((await fetchBusinessGrants(fetch, signal)).results, now);
    const chat = config.openAiEndpoint && config.chatDeployment
      ? new FoundryChatClient(config.openAiEndpoint, config.chatDeployment, credential, fetch, signal)
      : undefined;
    const extract = chat && ((title: string, text: string) => extractGrantFields(chat, title, text));
    const pageOptions = { ...(extract && { extract }), log, now, signal };
    const curated = await fetchCuratedGrants(undefined, { ...pageOptions, concurrency: 4 });
    const known = new Set(
      [...qld.documents, ...business.documents, ...curated.documents]
        .map((d) => d.url).filter((u): u is string => !!u).map(urlKey),
    );
    const discovered = await fetchBusinessQldPages(known, pageOptions);
    const smarty = await fetchSmartyGrants({ log, now, signal });
    const extra = [curated, discovered, smarty];
    const documents = [...qld.documents, ...business.documents, ...extra.flatMap((e) => e.documents)];
    const fetched = qld.fetched + business.fetched + extra.reduce((n, e) => n + e.fetched, 0);
    const duplicatesRemoved = qld.duplicatesRemoved + business.duplicatesRemoved
      + extra.reduce((n, e) => n + e.duplicatesRemoved, 0);
    log(`Fetched ${qld.fetched} QLD, ${business.fetched} business.gov.au, ${curated.fetched} curated, ${discovered.fetched} Business Queensland and ${smarty.fetched} SmartyGrants programs; ${duplicatesRemoved} duplicates collapsed → ${documents.length} documents.`);

    signal.throwIfAborted();
    const blob = await syncGrantsToBlob(container, documents, {
      now,
      retentionDays: config.softDeleteRetentionDays,
      preserveIds: discovered.failedIds,
      signal,
      historyContainer: storage.getContainerClient(config.historyContainer),
    });
    log(`Blob sync: ${JSON.stringify(blob)}`);

    let indexer: SyncSummary['indexer'] = 'notConfigured';
    if (config.searchEndpoint) {
      indexer = await new SearchRestClient(config.searchEndpoint, credential).runIndexer(config.indexerName);
      log(`Indexer '${config.indexerName}': ${indexer}`);
    }

    return {
      fetched,
      duplicatesRemoved,
      documents: documents.length,
      open: documents.filter((d) => d.isOpen).length,
      blob,
      indexer,
      durationMs: Date.now() - started,
    };
  });
}
