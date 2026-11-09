import { readFileSync } from 'node:fs'
import { jsonSchemaToZod } from 'json-schema-to-zod'
import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'

// The generated client MUST match the schema of `vv-protocol`, which a Rust
// test keeps current. `pnpm generate:protocol` writes the client again.
it('the generated protocol client is current', async () => {
  const schemaPath = new URL(
    '../../../crates/vv-protocol/schema/protocol.schema.json',
    import.meta.url,
  )
  const clientPath = new URL(
    '../src/shared/api/protocol.gen.ts',
    import.meta.url,
  )
  const code = jsonSchemaToZod(JSON.parse(readFileSync(schemaPath, 'utf8')), {
    name: 'protocol',
    module: 'esm',
  })
  const options = await resolveConfig(clientPath)
  const expected = await format(code, { ...options, parser: 'typescript' })
  expect(readFileSync(clientPath, 'utf8')).toBe(expected)
})
