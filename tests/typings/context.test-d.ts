import { it, expectTypeOf } from 'vitest'
import { type BrowserContext, type Page } from '@playwright/test'
import { type NetworkFixtureOptions } from '../../build/index.mjs'

it('accepts the playwright context or page type', () => {
  expectTypeOf<BrowserContext | Page>().toEqualTypeOf<
    NetworkFixtureOptions['context']
  >()
})
