import { defineConfig, defineField, defineType } from 'sanity'
import { structureTool } from 'sanity/structure'

// The plugin as published: the committed dist/, not src/.
import { vocalstack } from '../../dist/index.js'

const lake = process.env.SANITY_STUDIO_LAKE_URL ?? 'https://localhost:8711'
const handlerURL = process.env.SANITY_STUDIO_HANDLER_URL ?? 'http://127.0.0.1:8712/api/vocalstack'

export default defineConfig({
  name: 'default',
  title: 'VocalStack e2e',
  projectId: 'vse2e',
  dataset: 'e2e',
  // The fake Content Lake. Sanity prepends the project id: vse2e.localhost, which browsers resolve to loopback.
  apiHost: lake,
  plugins: [structureTool(), vocalstack({ handlerURL })],
  schema: {
    types: [
      defineType({
        name: 'episode',
        title: 'Episode',
        type: 'document',
        fields: [
          defineField({ name: 'title', type: 'string' }),
          defineField({ name: 'audio', type: 'file', options: { accept: 'audio/*' } }),
          defineField({ name: 'transcript', type: 'vocalstack.transcript' }),
        ],
      }),
    ],
  },
})
