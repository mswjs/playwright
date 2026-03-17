import { it, expectTypeOf } from 'vitest'
import { type BrowserContext } from '@playwright/test'
import { type NetworkFixtureOptions } from '../../build/index.mjs'

it('accepts the playwright context type', () => {
  expectTypeOf<BrowserContext>().toEqualTypeOf<
    NetworkFixtureOptions['context']
  >()
})
