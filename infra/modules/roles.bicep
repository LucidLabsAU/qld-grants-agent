param storageAccountName string
param searchServiceName string
param foundryAccountName string
param appInsightsName string
param functionPrincipalId string
param searchPrincipalId string
param projectPrincipalId string
param userPrincipalId string = ''
param userPrincipalType string = 'User'

var roleIds = {
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageBlobDataReader: '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
  searchServiceContributor: '7ca78c08-252a-4471-8644-bb5ff32d4ba0'
  searchIndexDataContributor: '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
  searchIndexDataReader: '1407120a-92aa-4202-b7e9-c0e197c71c8f'
  cognitiveServicesOpenAiUser: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
  azureAiUser: '53ca6127-db72-4b80-b1b0-d745d6d5456d'
  monitoringMetricsPublisher: '3913510d-42f4-4e42-8a64-420c390055eb'
  logAnalyticsReader: '73c42c96-874c-492b-b04d-ab87d138a893'
  privilegedMonitoringDataReader: 'dbc9c667-e97f-4491-aee6-90b9cf960190'
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource storage 'Microsoft.Storage/storageAccounts@2026-09-01' existing = {
  name: storageAccountName
}

resource search 'Microsoft.Search/searchServices@2026-09-01-preview' existing = {
  name: searchServiceName
}

resource foundry 'Microsoft.CognitiveServices/accounts@2026-09-15-preview' existing = {
  name: foundryAccountName
}

var hasUser = !empty(userPrincipalId)

var storageAssignments = concat(
  [
    { principalId: functionPrincipalId, type: 'ServicePrincipal', role: roleIds.storageBlobDataOwner } // host + deployment + grants container
    { principalId: searchPrincipalId, type: 'ServicePrincipal', role: roleIds.storageBlobDataReader } // blob indexer
  ],
  hasUser ? [{ principalId: userPrincipalId, type: userPrincipalType, role: roleIds.storageBlobDataContributor }] : []
)

var searchAssignments = concat(
  [
    { principalId: functionPrincipalId, type: 'ServicePrincipal', role: roleIds.searchServiceContributor } // run indexer
    { principalId: projectPrincipalId, type: 'ServicePrincipal', role: roleIds.searchIndexDataReader } // FoundryIQ / agents
    { principalId: projectPrincipalId, type: 'ServicePrincipal', role: roleIds.searchServiceContributor }
  ],
  hasUser
    ? [
        { principalId: userPrincipalId, type: userPrincipalType, role: roleIds.searchServiceContributor }
        { principalId: userPrincipalId, type: userPrincipalType, role: roleIds.searchIndexDataContributor }
      ]
    : []
)

var foundryAssignments = concat(
  [
    { principalId: searchPrincipalId, type: 'ServicePrincipal', role: roleIds.cognitiveServicesOpenAiUser } // embeddings + KB model
    { principalId: functionPrincipalId, type: 'ServicePrincipal', role: roleIds.cognitiveServicesOpenAiUser } // curated-page field extraction
  ],
  hasUser
    ? [
        { principalId: userPrincipalId, type: userPrincipalType, role: roleIds.azureAiUser }
        { principalId: userPrincipalId, type: userPrincipalType, role: roleIds.cognitiveServicesOpenAiUser }
      ]
    : []
)

// Agent traces: the project identity ingests (keyless) and reads them back for evaluations;
// the deploying user can view traces in the Foundry portal (incl. GenAI message content).
var appInsightsAssignments = concat(
  [
    { principalId: projectPrincipalId, type: 'ServicePrincipal', role: roleIds.monitoringMetricsPublisher }
    { principalId: projectPrincipalId, type: 'ServicePrincipal', role: roleIds.logAnalyticsReader }
    { principalId: projectPrincipalId, type: 'ServicePrincipal', role: roleIds.privilegedMonitoringDataReader }
  ],
  hasUser
    ? [
        { principalId: userPrincipalId, type: userPrincipalType, role: roleIds.logAnalyticsReader }
        { principalId: userPrincipalId, type: userPrincipalType, role: roleIds.privilegedMonitoringDataReader }
      ]
    : []
)

resource storageRoles 'Microsoft.Authorization/roleAssignments@2026-07-01-preview' = [
  for a in storageAssignments: {
    scope: storage
    name: guid(storage.id, a.principalId, a.role)
    properties: {
      principalId: a.principalId
      principalType: a.type
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', a.role)
    }
  }
]

resource searchRoles 'Microsoft.Authorization/roleAssignments@2026-07-01-preview' = [
  for a in searchAssignments: {
    scope: search
    name: guid(search.id, a.principalId, a.role)
    properties: {
      principalId: a.principalId
      principalType: a.type
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', a.role)
    }
  }
]

resource foundryRoles 'Microsoft.Authorization/roleAssignments@2026-07-01-preview' = [
  for a in foundryAssignments: {
    scope: foundry
    name: guid(foundry.id, a.principalId, a.role)
    properties: {
      principalId: a.principalId
      principalType: a.type
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', a.role)
    }
  }
]

resource appInsightsRoles 'Microsoft.Authorization/roleAssignments@2026-07-01-preview' = [
  for a in appInsightsAssignments: {
    scope: appInsights
    name: guid(appInsights.id, a.principalId, a.role)
    properties: {
      principalId: a.principalId
      principalType: a.type
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', a.role)
    }
  }
]
