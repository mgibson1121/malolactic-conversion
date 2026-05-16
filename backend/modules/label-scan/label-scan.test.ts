/**
 * label-scan/label-scan.test.ts
 * Unit tests for the label scan module.
 * All external calls (OpenAI, sharp) are mocked.
 */

jest.mock('openai')
jest.mock('sharp')
jest.mock('child_process', () => ({ execFile: jest.fn() }))
jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('converted-jpeg')),
  unlink: jest.fn().mockResolvedValue(undefined),
}))

import OpenAI from 'openai'
import sharp from 'sharp'
import { execFile } from 'child_process'
import { scanLabel } from './index'

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockInput = {
  imageBuffer: Buffer.from('fake-image-data'),
  mimeType: 'image/jpeg',
}

const fullScanJson = JSON.stringify({
  name: 'Clos de la Roche',
  producer: 'Domaine Dujac',
  vintage: 2019,
  region: 'Burgundy',
  denomination: 'Clos de la Roche Grand Cru',
  grape_varieties: ['Pinot Noir'],
  quality_classification: 'Grand Cru',
  vineyard: null,
})

function mockSharp() {
  const chain = {
    rotate: jest.fn().mockReturnThis(),
    toColorspace: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('resized-image')),
  }
  ;(sharp as unknown as jest.Mock).mockReturnValue(chain)
  return chain
}

function mockOpenAI(content: string) {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  })
  ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    chat: { completions: { create } },
  }))
  return create
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scanLabel', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey
  })

  describe('when OPENAI_API_KEY is not set', () => {
    it('returns available: false with reason no_api_key', async () => {
      delete process.env.OPENAI_API_KEY

      const result = await scanLabel(mockInput)

      expect(result.available).toBe(false)
      if (!result.available) {
        expect(result.reason).toBe('no_api_key')
      }
    })
  })

  describe('when OPENAI_API_KEY is set', () => {
    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
    })

    it('resizes image to max 1024px on longest side before API call', async () => {
      const sharpChain = mockSharp()
      mockOpenAI(fullScanJson)

      await scanLabel(mockInput)

      expect(sharp).toHaveBeenCalledWith(mockInput.imageBuffer, expect.objectContaining({ failOn: 'none' }))
      expect(sharpChain.rotate).toHaveBeenCalled()
      expect(sharpChain.resize).toHaveBeenCalledWith({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true,
      })
      expect(sharpChain.jpeg).toHaveBeenCalledWith({ quality: 90 })
    })

    it('returns a fully populated result for a clean scan', async () => {
      mockSharp()
      mockOpenAI(fullScanJson)

      const response = await scanLabel(mockInput)

      expect(response.available).toBe(true)
      if (!response.available) return

      const { result } = response
      expect(result.name).toBe('Clos de la Roche')
      expect(result.producer).toBe('Domaine Dujac')
      expect(result.vintage).toBe(2019)
      expect(result.region).toBe('Burgundy')
      expect(result.denomination).toBe('Clos de la Roche Grand Cru')
      expect(result.grape_varieties).toEqual(['Pinot Noir'])
      expect(result.quality_classification).toBe('Grand Cru')
      expect(result.vineyard).toBeNull()
      expect(result.missing_tier1_fields).toHaveLength(0)
    })

    it('flags missing Tier 1 fields in missing_tier1_fields', async () => {
      mockSharp()
      const partialJson = JSON.stringify({
        name: null,
        producer: 'Domaine Dujac',
        vintage: null,
        region: null,
        denomination: 'Clos de la Roche Grand Cru',
        grape_varieties: [],
        quality_classification: null,
        vineyard: null,
      })
      mockOpenAI(partialJson)

      const response = await scanLabel(mockInput)

      expect(response.available).toBe(true)
      if (!response.available) return

      expect(response.result.missing_tier1_fields).toEqual(
        expect.arrayContaining(['name', 'vintage', 'region'])
      )
      expect(response.result.missing_tier1_fields).not.toContain('producer')
      expect(response.result.missing_tier1_fields).not.toContain('denomination')
    })

    it('extracts Tier 2 vineyard field when present', async () => {
      mockSharp()
      const withVineyard = JSON.stringify({
        name: 'Barolo',
        producer: 'Giacomo Conterno',
        vintage: 2016,
        region: 'Piedmont',
        denomination: 'Barolo DOCG',
        grape_varieties: ['Nebbiolo'],
        quality_classification: 'Riserva',
        vineyard: 'Vigna Francia',
      })
      mockOpenAI(withVineyard)

      const response = await scanLabel(mockInput)

      expect(response.available).toBe(true)
      if (!response.available) return

      expect(response.result.quality_classification).toBe('Riserva')
      expect(response.result.vineyard).toBe('Vigna Francia')
    })

    it('handles JSON wrapped in markdown fences', async () => {
      mockSharp()
      const withFences = '```json\n' + fullScanJson + '\n```'
      mockOpenAI(withFences)

      const response = await scanLabel(mockInput)

      expect(response.available).toBe(true)
      if (!response.available) return
      expect(response.result.name).toBe('Clos de la Roche')
    })

    it('converts HEIC to JPEG via sips before passing to sharp', async () => {
      mockSharp()
      mockOpenAI(fullScanJson)

      // Make execFile call the callback with no error (success)
      ;(execFile as unknown as jest.Mock).mockImplementation((_cmd, _args, cb) => cb(null))

      const heicInput = { imageBuffer: Buffer.from('fake-heic'), mimeType: 'image/heic' }
      const response = await scanLabel(heicInput)

      expect(execFile).toHaveBeenCalledWith(
        '/usr/bin/sips',
        expect.arrayContaining(['-s', 'format', 'jpeg']),
        expect.any(Function)
      )
      expect(response.available).toBe(true)
    })

    it('returns unsupported_format when sharp cannot decode the image', async () => {
      // Make sharp throw with the IMAGE_FORMAT_UNSUPPORTED prefix
      const chain = {
        rotate: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(new Error('IMAGE_FORMAT_UNSUPPORTED: bad seek to 1234')),
      }
      ;(sharp as unknown as jest.Mock).mockReturnValue(chain)

      const response = await scanLabel(mockInput)

      expect(response.available).toBe(false)
      if (response.available) return
      expect(response.reason).toBe('unsupported_format')
    })

    it('returns all missing Tier 1 fields when JSON cannot be parsed', async () => {
      mockSharp()
      mockOpenAI('not valid json at all')

      const response = await scanLabel(mockInput)

      expect(response.available).toBe(true)
      if (!response.available) return

      expect(response.result.missing_tier1_fields).toEqual(
        expect.arrayContaining(['name', 'producer', 'vintage', 'region', 'denomination'])
      )
      expect(response.result.raw_response).toBe('not valid json at all')
    })

    it('defaults grape_varieties to empty array when missing', async () => {
      mockSharp()
      const noGrapes = JSON.stringify({
        name: 'Test Wine',
        producer: 'Test Producer',
        vintage: 2020,
        region: 'Burgundy',
        denomination: 'Bourgogne AOC',
        quality_classification: null,
        vineyard: null,
        // grape_varieties intentionally omitted
      })
      mockOpenAI(noGrapes)

      const response = await scanLabel(mockInput)

      expect(response.available).toBe(true)
      if (!response.available) return
      expect(response.result.grape_varieties).toEqual([])
    })
  })
})
