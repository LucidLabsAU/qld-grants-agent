param location string
param tags object
param planName string
param name string
param storageAccountName string
param deploymentContainerUrl string
param appInsightsConnectionString string

@description('Additional app settings (name -> value).')
@secure()
param appSettings object

// Flex Consumption plan (Linux, serverless, scale to zero).
resource plan 'Microsoft.Web/serverfarms@2026-08-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

var baseSettings = {
  AzureWebJobsStorage__accountName: storageAccountName
  AzureWebJobsStorage__credential: 'managedidentity'
  APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
}

resource site 'Microsoft.Web/sites@2026-08-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      appSettings: [for s in items(union(baseSettings, appSettings)): { name: s.key, value: s.value }]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: deploymentContainerUrl
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
}

output name string = site.name
output principalId string = site.identity.principalId
