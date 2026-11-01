// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { OperationsContext, type Store } from './store';

const mocks = vi.hoisted(() => ({ classify: vi.fn(), operation: vi.fn() }));
vi.mock('./photoClassifier', async () => ({ ...(await vi.importActual<typeof import('./photoClassifier')>('./photoClassifier')), classifyPhoto: mocks.classify }));
vi.mock('./store', async () => ({ ...(await vi.importActual<typeof import('./store')>('./store')), operation: mocks.operation }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ data: null })) } }));
vi.mock('exifr', () => ({ parse: vi.fn(async () => null) }));
vi.mock('hash-wasm', () => ({ createSHA256: async () => ({ update() {}, digest: () => 'unique-sha' }), createMD5: async () => ({ update() {}, digest: () => 'unique-md5' }) }));
vi.mock('./Map', () => ({ FieldMap: ({ onPick }: {onPick:(lat:number,lng:number)=>void}) => <button type="button" onClick={() => onPick(17.5, 121.8)}>Choose field</button> }));
import { UploadWorkspace } from './Upload';

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 1024, close() {} }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('photo review before any original upload or automation', () => {
  it('waits for classification and explicit approval before creating a live survey', async () => {
    let resolve!: (value: unknown) => void;
    mocks.classify.mockReturnValue(new Promise((done) => { resolve = done; }));
    // The intentional failure stops this fixture before any network upload.
    const addSurvey = vi.fn(async (_survey: unknown) => { throw new Error('fixture stop before upload'); });
    const store = { data: { surveys: [], assets: [], jobs: [], bulletins: [], contacts: [], campaigns: [], models: [], providers: {} },
      demo: false, loading: false, error: null, addSurvey, refresh: vi.fn() } as unknown as Store;
    const router = createMemoryRouter([{ path: '*', element: <UploadWorkspace /> }], { initialEntries: ['/admin/upload'] });
    render(<OperationsContext.Provider value={store}><RouterProvider router={router}/></OperationsContext.Provider>);
    const user = userEvent.setup();
    const file = new File([new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0])], 'field.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'slice', { value: () => ({ arrayBuffer: async () => new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0]).buffer }) });
    await user.upload(document.querySelector('input[type=file]')!, file);
    await waitFor(() => expect(mocks.classify).toHaveBeenCalledOnce(), { timeout: 10000 });
    await user.click(screen.getByRole('button', { name: 'Choose field' }));
    const approve = screen.getByRole('checkbox', { name: /Nasuri ko na/ }) as HTMLInputElement;
    const submit = screen.getByRole('button', { name: 'I-upload at suriin' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true); expect(submit.disabled).toBe(true);
    expect(addSurvey).not.toHaveBeenCalled(); expect(mocks.operation).not.toHaveBeenCalled();
    resolve({ model: 'fixture-cls', probs: { BLB: 0.1, 'Brown Spot': 0.1, 'Soil Nitrogen': 0.8 }, top: 'Soil Nitrogen', uncertain: false, tiles: 4 });
    await waitFor(() => expect(approve.disabled).toBe(false), { timeout: 10000 });
    expect(submit.disabled).toBe(true); expect(addSurvey).not.toHaveBeenCalled();
    await user.click(approve); expect(submit.disabled).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(addSurvey).toHaveBeenCalledOnce());
    expect(addSurvey.mock.calls[0][0]).toMatchObject({ pre_review: { approved: true, classifier: 'fixture-cls' } });
    expect(mocks.operation).not.toHaveBeenCalled();
  }, 20000);
});
