targetScope = 'resourceGroup'

@allowed(['azure', 'fabric', 'hybrid'])
@description('azure preserves the original backend; fabric uses Rayfin-managed services; hybrid deploys Azure plus the separately published Fabric app.')
param appBackend string = 'azure'

@description('Existing Fabric workspace ID. Rayfin, not ARM, publishes the Fabric app into this workspace.')
param fabricWorkspaceId string = ''

@description('Entra tenant ID for the existing Fabric workspace.')
param fabricTenantId string = ''

@description('Display name for the Rayfin Fabric app.')
param fabricAppName string = 'Grants Workbench'

@description('Existing Azure OpenAI resource root endpoint for Fabric chat. In hybrid mode, leave empty to use the deployed Foundry model.')
param fabricAiEndpoint string = ''

@description('Existing Azure OpenAI deployment name for Fabric chat. In hybrid mode, leave empty to use the deployed chat model.')
param fabricAiDeployment string = ''

@description('Provision a separate Entra-only Azure OpenAI resource reachable by Fabric. No changes to existing model firewalls.')
param deployFabricAi bool = false

@description('Dedicated Fabric chat model. capacity is in thousands of tokens per minute; Standard keeps inference in the selected region.')
param fabricAiModel object = {
  name: 'gpt-4.1-mini'
  version: '2025-04-14'
  sku: 'Standard'
  capacity: 30
}

@description('Region for the optional dedicated Fabric chat model.')
param fabricAiLocation string = location

@description('Entra object ID of the Fabric AppBackend owner, whose external AI token is used by Rayfin functions. Required when deployFabricAi is true.')
param fabricAiPrincipalId string = principalId

@description('Short name used to derive resource names, e.g. "qldgrants".')
@minLength(3)
@maxLength(12)
param environmentName string = 'qldgrants'

@description('Region for all resources. Must support the AI Search Serverless tier, semantic ranker and agentic retrieval (e.g. australiaeast).')
param location string = resourceGroup().location

@secure()
@description('X-Api-Key for the QLD Grants Finder API.')
param qldApiKey string = ''

@description('Object id of the user/principal running the deployment. Grants data-plane roles so you can run the setup and query scripts locally. Leave empty to skip.')
param principalId string = ''

@allowed(['User', 'ServicePrincipal', 'Group'])
param principalType string = 'User'

@allowed(['free', 'standard'])
@description('Semantic ranker billing plan.')
param semanticSearch string = 'standard'

@allowed(['free', 'standard'])
@description('Agentic retrieval (FoundryIQ knowledge base) billing plan.')
param knowledgeRetrieval string = 'standard'

@description('Embedding model deployment (used for integrated vectorization and query-time vectorizer).')
param embeddingModel object = {
  name: 'text-embedding-3-small'
  version: '1'
  dimensions: 1536
  sku: 'GlobalStandard'
  capacity: 120
}

@description('Chat model deployment used by the FoundryIQ knowledge base for query planning and answer synthesis.')
param chatModel object = {
  name: 'gpt-5.4-mini'
  version: '2026-03-17'
  sku: 'GlobalStandard'
  capacity: 50
}

@description('CRON (UTC) for the sync Function. Default: Saturday 16:00 UTC = Sunday 02:00 AEST.')
param syncSchedule string = '0 0 16 * * 6'

param tags object = {
  project: 'qld-grants-agent'
}

@description('Extra tags for the storage account only, e.g. { SecurityControl: \'Ignore\' } where an org policy would otherwise force public network access off (the Function deployment and serverless Search indexer need it).')
param storageExtraTags object = {}

var token = toLower(uniqueString(subscription().id, resourceGroup().id, environmentName))
var names = {
  logs: 'log-${environmentName}-${token}'
  appInsights: 'appi-${environmentName}-${token}'
  storage: take('st${environmentName}${token}', 24)
  search: 'srch-${environmentName}-${token}'
  foundry: 'aif-${environmentName}-${token}'
  project: 'proj-${environmentName}'
  plan: 'plan-${environmentName}-${token}'
  functionApp: 'func-${environmentName}-${token}'
}
var grantsContainer = 'grants'
var grantsHistoryContainer = 'grants-history'
var deploymentContainer = 'app-package'
var indexerName = 'grants-indexer'
var knowledgeBaseName = 'grants-kb'
var searchDataApiVersion = '2026-08-01-preview'
var deployAzure = appBackend != 'fabric'

module fabricAi 'modules/fabric-ai.bicep' = if (deployFabricAi) {
  name: 'fabric-ai'
  params: {
    location: fabricAiLocation
    tags: tags
    accountName: 'aoai-${environmentName}-fabric-${token}'
    model: fabricAiModel
    principalId: fabricAiPrincipalId
    deploymentName: !empty(fabricAiDeployment) ? fabricAiDeployment : fabricAiModel.name
  }
}

module monitoring 'modules/monitoring.bicep' = if (deployAzure) {
  name: 'monitoring'
  params: {
    location: location
    tags: tags
    logAnalyticsName: names.logs
    appInsightsName: names.appInsights
  }
}

module storage 'modules/storage.bicep' = if (deployAzure) {
  name: 'storage'
  params: {
    location: location
    tags: union(tags, storageExtraTags)
    name: names.storage
    containers: [grantsContainer, grantsHistoryContainer, deploymentContainer]
  }
}

module search 'modules/search.bicep' = if (deployAzure) {
  name: 'search'
  params: {
    location: location
    tags: tags
    name: names.search
    semanticSearch: semanticSearch
    knowledgeRetrieval: knowledgeRetrieval
  }
}

module foundry 'modules/foundry.bicep' = if (deployAzure) {
  name: 'foundry'
  params: {
    location: location
    tags: tags
    accountName: names.foundry
    projectName: names.project
    embeddingModel: embeddingModel
    chatModel: chatModel
    searchServiceId: search!.outputs.id
    searchEndpoint: search!.outputs.endpoint
    knowledgeBaseName: knowledgeBaseName
    searchApiVersion: searchDataApiVersion
    appInsightsId: monitoring!.outputs.appInsightsId
    appInsightsConnectionString: monitoring!.outputs.appInsightsConnectionString
  }
}

module functionApp 'modules/function.bicep' = if (deployAzure) {
  name: 'function'
  params: {
    location: location
    tags: tags
    planName: names.plan
    name: names.functionApp
    storageAccountName: storage!.outputs.name
    deploymentContainerUrl: '${storage!.outputs.blobEndpoint}${deploymentContainer}'
    appInsightsConnectionString: monitoring!.outputs.appInsightsConnectionString
    appSettings: {
      QLD_API_BASE_URL: 'https://api.jus-checklist.services.qld.gov.au/v1/api/legacy/resources/grants'
      QLD_API_KEY: qldApiKey
      GRANTS_STORAGE_ACCOUNT_URL: storage!.outputs.blobEndpoint
      GRANTS_CONTAINER: grantsContainer
      GRANTS_HISTORY_CONTAINER: grantsHistoryContainer
      SEARCH_ENDPOINT: search!.outputs.endpoint
      SEARCH_INDEXER_NAME: indexerName
      FOUNDRY_OPENAI_ENDPOINT: foundry!.outputs.openAiEndpoint
      CHAT_DEPLOYMENT: foundry!.outputs.chatDeployment
      SYNC_SCHEDULE: syncSchedule
    }
  }
}

module roles 'modules/roles.bicep' = if (deployAzure) {
  name: 'roles'
  params: {
    storageAccountName: storage!.outputs.name
    searchServiceName: search!.outputs.name
    foundryAccountName: foundry!.outputs.accountName
    appInsightsName: monitoring!.outputs.appInsightsName
    functionPrincipalId: functionApp!.outputs.principalId
    searchPrincipalId: search!.outputs.principalId
    projectPrincipalId: foundry!.outputs.projectPrincipalId
    userPrincipalId: principalId
    userPrincipalType: principalType
  }
}

// UPPER_SNAKE_CASE outputs map 1:1 to the settings used by the scripts (see scripts/env.ts).
output AZURE_RESOURCE_GROUP string = resourceGroup().name
output AZURE_LOCATION string = location
output APP_BACKEND string = appBackend
output FABRIC_WORKSPACE_ID string = fabricWorkspaceId
output FABRIC_TENANT_ID string = fabricTenantId
output FABRIC_APP_NAME string = fabricAppName
output FABRIC_AI_ENDPOINT string = deployFabricAi ? fabricAi!.outputs.endpoint : (!empty(fabricAiEndpoint) ? fabricAiEndpoint : (appBackend == 'hybrid' ? foundry!.outputs.openAiEndpoint : ''))
output FABRIC_AI_DEPLOYMENT string = deployFabricAi ? fabricAi!.outputs.deploymentName : (!empty(fabricAiDeployment) ? fabricAiDeployment : (appBackend == 'hybrid' ? foundry!.outputs.chatDeployment : ''))
output FABRIC_AI_ACCOUNT_NAME string = deployFabricAi ? fabricAi!.outputs.accountName : ''
output FABRIC_AI_RESOURCE_ID string = deployFabricAi ? fabricAi!.outputs.id : ''
output SEARCH_SERVICE_NAME string = deployAzure ? search!.outputs.name : ''
output SEARCH_ENDPOINT string = deployAzure ? search!.outputs.endpoint : ''
output STORAGE_ACCOUNT_ID string = deployAzure ? storage!.outputs.id : ''
output GRANTS_STORAGE_ACCOUNT_URL string = deployAzure ? storage!.outputs.blobEndpoint : ''
output GRANTS_CONTAINER string = grantsContainer
output GRANTS_HISTORY_CONTAINER string = grantsHistoryContainer
output SEARCH_INDEXER_NAME string = indexerName
output FOUNDRY_ACCOUNT_NAME string = deployAzure ? foundry!.outputs.accountName : ''
output FOUNDRY_PROJECT_NAME string = deployAzure ? foundry!.outputs.projectName : ''
output FOUNDRY_PROJECT_ENDPOINT string = deployAzure ? foundry!.outputs.projectEndpoint : ''
output KNOWLEDGE_BASE_NAME string = knowledgeBaseName
output KB_MCP_CONNECTION_NAME string = deployAzure ? foundry!.outputs.kbMcpConnectionName : ''
output FOUNDRY_OPENAI_ENDPOINT string = deployAzure ? foundry!.outputs.openAiEndpoint : ''
output EMBEDDING_DEPLOYMENT string = deployAzure ? foundry!.outputs.embeddingDeployment : ''
output EMBEDDING_MODEL string = embeddingModel.name
output EMBEDDING_DIMENSIONS int = embeddingModel.dimensions
output CHAT_DEPLOYMENT string = deployAzure ? foundry!.outputs.chatDeployment : ''
output CHAT_MODEL string = chatModel.name
output FUNCTION_APP_NAME string = deployAzure ? functionApp!.outputs.name : ''
