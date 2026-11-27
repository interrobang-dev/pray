import { describe, expect, it } from 'vitest'
import { pdfAssetUrl } from './pdfAssets'

describe('pdfAssetUrl', () => {
  it('finds the bundled CMap, standard font and wasm files', () => {
    expect(pdfAssetUrl('cMapUrl', 'UniKS-UCS2-H.bcmap')).toBeTruthy()
    expect(pdfAssetUrl('standardFontDataUrl', 'FoxitSymbol.pfb')).toBeTruthy()
    expect(pdfAssetUrl('standardFontDataUrl', 'LiberationSans-Regular.ttf')).toBeTruthy()
    expect(pdfAssetUrl('wasmUrl', 'openjpeg.wasm')).toBeTruthy()
    expect(pdfAssetUrl('wasmUrl', 'jbig2.wasm')).toBeTruthy()
  })

  it('returns null for anything else', () => {
    expect(pdfAssetUrl('cMapUrl', 'Nope.bcmap')).toBeNull()
    expect(pdfAssetUrl('other', 'openjpeg.wasm')).toBeNull()
    expect(pdfAssetUrl('wasmUrl', 'quickjs-eval.wasm')).toBeNull()
    expect(pdfAssetUrl('wasmUrl', 'qcms_bg.wasm')).toBeNull()
  })
})
