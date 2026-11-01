targetScope = 'subscription'

param resourceGroupName string = 'qld-grants-fabric-rg'
param location string = 'australiaeast'
param environmentName string = 'qldgrants'
param fabricWorkspaceId string
param fabricTenantId string
param fabricAppName string = 'Grants Workbench'
param fabricAiPrincipalId string = ''
param deployFabricAi bool = true
param fabricAiEndpoint string = ''
param fabricAiDeployment string = ''
param fabricAiModel object = {
  name: 'gpt-4.1-mini'
  version: '2025-04-14'
  sku: 'Standard'
  capacity: 30
}
param tags object = {
  project: 'qld-grants-agent'
}

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module app 'main.bicep' = {
  name: 'main'
  scope: group
  params: {
    appBackend: 'fabric'
    environmentName: environmentName
    location: location
    tags: tags
    fabricWorkspaceId: fabricWorkspaceId
    fabricTenantId: fabricTenantId
    fabricAppName: fabricAppName
    deployFabricAi: deployFabricAi
    fabricAiPrincipalId: fabricAiPrincipalId
    fabricAiModel: fabricAiModel
    fabricAiEndpoint: fabricAiEndpoint
    fabricAiDeployment: fabricAiDeployment
  }
}

output AZURE_RESOURCE_GROUP string = group.name
output APP_BACKEND string = app.outputs.APP_BACKEND
output FABRIC_WORKSPACE_ID string = app.outputs.FABRIC_WORKSPACE_ID
output FABRIC_TENANT_ID string = app.outputs.FABRIC_TENANT_ID
output FABRIC_APP_NAME string = app.outputs.FABRIC_APP_NAME
output FABRIC_AI_ENDPOINT string = app.outputs.FABRIC_AI_ENDPOINT
output FABRIC_AI_DEPLOYMENT string = app.outputs.FABRIC_AI_DEPLOYMENT
output FABRIC_AI_ACCOUNT_NAME string = app.outputs.FABRIC_AI_ACCOUNT_NAME
output FABRIC_AI_RESOURCE_ID string = app.outputs.FABRIC_AI_RESOURCE_ID
