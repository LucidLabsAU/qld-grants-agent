using 'fabric.bicep'

// Bicep creates the resource group and optional AI model; Rayfin manages the app itself.
param resourceGroupName = readEnvironmentVariable('FABRIC_RESOURCE_GROUP', 'qld-grants-fabric-rg')
param location = readEnvironmentVariable('FABRIC_AI_LOCATION', 'australiaeast')
param deployFabricAi = readEnvironmentVariable('FABRIC_DEPLOY_AI', 'true') == 'true'
param fabricAiPrincipalId = readEnvironmentVariable('FABRIC_AI_PRINCIPAL_ID', '')
param fabricWorkspaceId = readEnvironmentVariable('FABRIC_WORKSPACE_ID')
param fabricTenantId = readEnvironmentVariable('FABRIC_TENANT_ID')
param fabricAppName = readEnvironmentVariable('FABRIC_APP_NAME', 'Grants Workbench')
param fabricAiEndpoint = readEnvironmentVariable('FABRIC_AI_ENDPOINT', '')
param fabricAiDeployment = readEnvironmentVariable('FABRIC_AI_DEPLOYMENT', '')
