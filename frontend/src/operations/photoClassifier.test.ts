// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });
const manifest = { model: 'fixture', classes: ['BLB', 'Brown Spot', 'Soil Nitrogen'], input_size: 384,
  tile: 512, stride: 384, scale: 0.5, parts: ['part0.bin'], sha256: '0'.repeat(64) };

describe('classifier publication and preprocessing contract', () => {
  it('allows explicit manual review when a model has not been published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const { loadPhotoClassifier } = await import('./photoClassifier');
    expect(await loadPhotoClassifier()).toBeNull();
  });
  it.each([{ stride: 0 }, { scale: 0 }, { input_size: 50000 }, { parts: [] }])(
    'rejects invalid dimensions and tile steps before allocating inference data: %s', async (override) => {
      const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...manifest, ...override }) }));
      vi.stubGlobal('fetch', fetch);
      const { loadPhotoClassifier } = await import('./photoClassifier');
      await expect(loadPhotoClassifier()).rejects.toThrow('manifest is invalid');
      expect(fetch).toHaveBeenCalledOnce();
    });
  it('rejects a reordered class list instead of silently swapping probability labels', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...manifest, classes: [...manifest.classes].reverse() }) })));
    const { loadPhotoClassifier } = await import('./photoClassifier');
    await expect(loadPhotoClassifier()).rejects.toThrow('classes do not match');
  });
});
