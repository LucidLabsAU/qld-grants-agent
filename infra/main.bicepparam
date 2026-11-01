using 'main.bicep'

param environmentName = 'qldgrants'
param location = 'australiaeast'

param appBackend = readEnvironmentVariable('APP_BACKEND', 'azure')
param fabricWorkspaceId = readEnvironmentVariable('FABRIC_WORKSPACE_ID', '')
param fabricTenantId = readEnvironmentVariable('FABRIC_TENANT_ID', '')
param fabricAppName = readEnvironmentVariable('FABRIC_APP_NAME', 'Grants Workbench')
param fabricAiEndpoint = readEnvironmentVariable('FABRIC_AI_ENDPOINT', '')
param fabricAiDeployment = readEnvironmentVariable('FABRIC_AI_DEPLOYMENT', '')
param deployFabricAi = readEnvironmentVariable('FABRIC_DEPLOY_AI', 'false') == 'true'
param fabricAiLocation = readEnvironmentVariable('FABRIC_AI_LOCATION', 'australiaeast')
param fabricAiPrincipalId = readEnvironmentVariable('FABRIC_AI_PRINCIPAL_ID', readEnvironmentVariable('AZURE_PRINCIPAL_ID', ''))

// Supplied at deploy time: az deployment group create ... -p qldApiKey=<key> principalId=<your-object-id>
param qldApiKey = readEnvironmentVariable('QLD_API_KEY', '')
param principalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')

// Opt out of an org policy that forces storage public network access off (set STORAGE_POLICY_OPT_OUT=true).
param storageExtraTags = readEnvironmentVariable('STORAGE_POLICY_OPT_OUT', 'false') == 'true' ? { SecurityControl: 'Ignore' } : {}
