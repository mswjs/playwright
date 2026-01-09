import { test as testBase, expect } from '@playwright/test'
import { http } from 'msw'
import { createNetworkFixture, type NetworkFixture } from '../src/index.js'

interface Fixtures {
  network: NetworkFixture
}

const test = testBase.extend<Fixtures>({
  network: createNetworkFixture({
    //
  }),
})

test('', async ({ page }) => {
  await page.goto('/')
})
