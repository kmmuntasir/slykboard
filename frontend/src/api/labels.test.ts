import { describe, it, expect, vi, afterEach } from 'vitest';
import { listLabels, createLabel, updateLabel, deleteLabel } from './labels';
import type {
  Label,
  CreateLabelDto,
  UpdateLabelDto,
} from '../types/label';

// F14 T5: assert each label API fn hits the right URL/method/body and unwraps
// the { data } envelope. Mocks globalThis.fetch — matches tickets.test.ts style.

const sampleLabel: Label = {
  id: 'l1',
  name: 'Bug',
  color: '#FF0000',
};

describe('listLabels', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GETs /projects/:slug/labels and unwraps the envelope', async () => {
    const returned: Label[] = [sampleLabel];
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: returned }), { status: 200 }),
    );

    const result = await listLabels('slyk');

    expect(result).toEqual(returned);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/projects/slyk/labels');
    expect(init?.method).toBeUndefined(); // GET — no method set
  });

  it('throws ApiClientError when the server responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'nope', code: 'INTERNAL_ERROR' } }),
        { status: 500 },
      ),
    );

    await expect(listLabels('slyk')).rejects.toThrow('nope');
  });
});

describe('createLabel', () => {
  afterEach(() => vi.restoreAllMocks());

  const dto: CreateLabelDto = { name: 'Bug', color: '#FF0000' };

  it('POSTs /projects/:slug/labels with the dto body and unwraps the envelope', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: sampleLabel }), { status: 201 }),
    );

    const result = await createLabel('slyk', dto);

    expect(result).toEqual(sampleLabel);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/projects/slyk/labels');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify(dto));
  });

  it('throws ApiClientError on CONFLICT (duplicate name)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'exists', code: 'CONFLICT' },
        }),
        { status: 409 },
      ),
    );

    await expect(createLabel('slyk', dto)).rejects.toThrow('exists');
  });
});

describe('updateLabel', () => {
  afterEach(() => vi.restoreAllMocks());

  const cases: Array<{ name: string; dto: UpdateLabelDto }> = [
    { name: 'name only', dto: { name: 'Defect' } },
    { name: 'color only', dto: { color: '#0000FF' } },
    { name: 'name + color', dto: { name: 'Defect', color: '#0000FF' } },
  ];

  cases.forEach(({ name, dto }) => {
    it(`PATCHes /labels/:id with ${name}`, async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: sampleLabel }), { status: 200 }),
      );

      const result = await updateLabel('l1', dto);

      expect(result).toEqual(sampleLabel);

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] ?? [];
      expect(String(url)).toContain('/labels/l1');
      expect(init?.method).toBe('PATCH');
      expect(init?.body).toBe(JSON.stringify(dto));
    });
  });

  it('throws ApiClientError when the server responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'not found', code: 'NOT_FOUND' } }),
        { status: 404 },
      ),
    );

    await expect(updateLabel('l1', { name: 'x' })).rejects.toThrow('not found');
  });
});

describe('deleteLabel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('DELETEs /labels/:id and unwraps { id }', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'l1' } }), { status: 200 }),
    );

    const result = await deleteLabel('l1');

    expect(result).toEqual({ id: 'l1' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/labels/l1');
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('throws ApiClientError when the server responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'not found', code: 'NOT_FOUND' } }),
        { status: 404 },
      ),
    );

    await expect(deleteLabel('l1')).rejects.toThrow('not found');
  });
});
