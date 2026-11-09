import { readFileSync } from 'node:fs'
import { jsonSchemaToZod } from 'json-schema-to-zod'
import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'
import { methods, PROTOCOL_VERSION } from '../src/shared/api/engine.ts'

const schemaPath = new URL(
  '../../../crates/vvorkflow-protocol/schema/protocol.schema.json',
  import.meta.url,
)
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  'x-protocol-version': number
  properties: {
    request: { oneOf: { properties: { method: { const: string } } }[] }
  }
}

// The generated client MUST match the schema of `vvorkflow-protocol`, which a Rust
// test keeps current. `pnpm generate:protocol` writes the client again.
it('the generated protocol client is current', async () => {
  const clientPath = new URL(
    '../src/shared/api/protocol.gen.ts',
    import.meta.url,
  )
  const code = jsonSchemaToZod(schema, {
    name: 'protocol',
    module: 'esm',
  })
  const options = await resolveConfig(clientPath)
  const expected = await format(code, { ...options, parser: 'typescript' })
  expect(readFileSync(clientPath, 'utf8')).toBe(expected)
})

// The generator types the request union as `any`, so the client keeps its own
// map of the methods, which MUST be those of the schema.
it('the client has each method of the protocol, and its version', () => {
  const inSchema = schema.properties.request.oneOf.map(
    (variant) => variant.properties.method.const,
  )
  expect(Object.keys(methods).sort()).toEqual(inSchema.sort())
  expect(PROTOCOL_VERSION).toBe(schema['x-protocol-version'])
})
