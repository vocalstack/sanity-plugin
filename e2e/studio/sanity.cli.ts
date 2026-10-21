import { defineCliConfig } from 'sanity/cli'

export default defineCliConfig({
  api: { dataset: 'e2e', projectId: 'vse2e' },
  // No update checks or telemetry: nothing here talks to sanity.io.
  autoUpdates: false,
})
