import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { errors } from '@elastic/elasticsearch';
import {
  taxonomyTerm as term,
  taxonomyTermsIndex,
  taxonomyTermsIndexNotFound,
} from 'src/common/testing/taxonomy-terms-index';
import {
  TAXONOMY_TERMS_CODES_PER_QUERY,
  TAXONOMY_TERMS_PAGE_SIZE,
  TaxonomyNameService,
} from './taxonomy-name.service';

const HSIS_WRITER = 'writer-hsis';
const LOCAL_WRITER = 'writer-local';

describe('TaxonomyNameService', () => {
  const search = jest.fn();
  const service = new TaxonomyNameService({
    search,
  } as unknown as ElasticsearchService);

  const reference = (docs: Parameters<typeof taxonomyTermsIndex>[0]) =>
    search.mockImplementation(taxonomyTermsIndex(docs));

  beforeEach(() => search.mockReset());

  it("returns each writer's own name for the same code", async () => {
    reference([
      term(HSIS_WRITER, 'BD', { en: 'Food' }),
      term(LOCAL_WRITER, 'BD', { en: 'Groceries' }),
    ]);

    await expect(
      service.lookup({
        resourceWriterIds: [HSIS_WRITER, LOCAL_WRITER],
        codes: ['BD'],
      }),
    ).resolves.toEqual({
      names: {
        [HSIS_WRITER]: { BD: 'Food' },
        [LOCAL_WRITER]: { BD: 'Groceries' },
      },
    });
  });

  it('never answers for a writer or a code outside the request', async () => {
    reference([
      term(HSIS_WRITER, 'BD', { en: 'Food' }),
      term(HSIS_WRITER, 'BH', { en: 'Housing' }),
      term(LOCAL_WRITER, 'BD', { en: 'Groceries' }),
    ]);

    await expect(
      service.lookup({ resourceWriterIds: [HSIS_WRITER], codes: ['BD'] }),
    ).resolves.toEqual({ names: { [HSIS_WRITER]: { BD: 'Food' } } });
  });

  it('matches a requested code in normalized form, keyed as requested', async () => {
    reference([term(HSIS_WRITER, 'BD-1800', { en: 'Emergency Food' })]);

    await expect(
      service.lookup({
        resourceWriterIds: [HSIS_WRITER],
        codes: [' BD-1800. '],
      }),
    ).resolves.toEqual({
      names: { [HSIS_WRITER]: { ' BD-1800. ': 'Emergency Food' } },
    });
  });

  it('matches a code the writer stored with a trailing separator', async () => {
    reference([
      term(HSIS_WRITER, 'BD-1800.', { en: 'Emergency Food' }),
      term(LOCAL_WRITER, 'BD-1800-', { en: 'Food Now' }),
    ]);

    await expect(
      service.lookup({
        resourceWriterIds: [HSIS_WRITER, LOCAL_WRITER],
        codes: ['BD-1800'],
      }),
    ).resolves.toEqual({
      names: {
        [HSIS_WRITER]: { 'BD-1800': 'Emergency Food' },
        [LOCAL_WRITER]: { 'BD-1800': 'Food Now' },
      },
    });
  });

  it('names in the requested locale, omitting a code named only in another', async () => {
    reference([
      term(HSIS_WRITER, 'BD', { en: 'Food', es: 'Alimentos' }),
      term(HSIS_WRITER, 'BH', { en: 'Housing' }),
    ]);

    await expect(
      service.lookup({
        resourceWriterIds: [HSIS_WRITER],
        codes: ['BD', 'BH'],
        locale: 'es',
      }),
    ).resolves.toEqual({ names: { [HSIS_WRITER]: { BD: 'Alimentos' } } });
  });

  it("prefers a writer's own term over a derived ancestor across taxonomies", async () => {
    reference([
      term(HSIS_WRITER, 'BD', { en: 'Pantry Network' }, { taxonomy: 'Local' }),
      term(HSIS_WRITER, 'BD', { en: 'Food' }, { isAncestor: true }),
    ]);

    await expect(
      service.lookup({ resourceWriterIds: [HSIS_WRITER], codes: ['BD'] }),
    ).resolves.toEqual({ names: { [HSIS_WRITER]: { BD: 'Pantry Network' } } });
  });

  it('takes the lowest name between two own terms, whatever order they arrive in', async () => {
    const own = [
      term(HSIS_WRITER, 'BD', { en: 'Alpha Food' }),
      term(HSIS_WRITER, 'BD', { en: 'Zeta Food' }, { taxonomy: 'Local' }),
    ];
    for (const docs of [own, [...own].reverse()]) {
      reference(docs);
      await expect(
        service.lookup({ resourceWriterIds: [HSIS_WRITER], codes: ['BD'] }),
      ).resolves.toEqual({ names: { [HSIS_WRITER]: { BD: 'Alpha Food' } } });
    }
  });

  it('answers no names before the reference index exists', async () => {
    search.mockRejectedValue(taxonomyTermsIndexNotFound());

    await expect(
      service.lookup({ resourceWriterIds: [HSIS_WRITER], codes: ['BD'] }),
    ).resolves.toEqual({ names: {} });
  });

  it('maps an ES timeout to 503 and any other failure to 502', async () => {
    search.mockRejectedValueOnce(new errors.TimeoutError('slow'));
    await expect(
      service.lookup({ resourceWriterIds: [HSIS_WRITER], codes: ['BD'] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    search.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.lookup({ resourceWriterIds: [HSIS_WRITER], codes: ['BD'] }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('reads every page of the reference instead of truncating it', async () => {
    const codes = Array.from(
      { length: TAXONOMY_TERMS_PAGE_SIZE + 1 },
      (_, i) => `AA-${String(i).padStart(5, '0')}`,
    );
    reference(codes.map((code) => term(HSIS_WRITER, code, { en: `n${code}` })));

    const { names } = await service.lookup({
      resourceWriterIds: [HSIS_WRITER],
      codes,
    });

    expect(Object.keys(names[HSIS_WRITER])).toHaveLength(codes.length);
    expect(names[HSIS_WRITER][codes[codes.length - 1]]).toBe(
      `n${codes[codes.length - 1]}`,
    );
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('pins every page of one lookup to the same shard copies', async () => {
    const codes = Array.from(
      { length: TAXONOMY_TERMS_PAGE_SIZE + 1 },
      (_, i) => `AA-${String(i).padStart(5, '0')}`,
    );
    reference(codes.map((code) => term(HSIS_WRITER, code, { en: code })));

    await service.lookup({ resourceWriterIds: [HSIS_WRITER], codes });
    await service.lookup({ resourceWriterIds: [LOCAL_WRITER], codes });
    const [first, second, other] = search.mock.calls.map(
      ([request]) => request.preference,
    );

    expect(first).toMatch(/^taxonomy-terms-/);
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("splits a long code list so no query outgrows ES's terms limit", async () => {
    const codes = Array.from(
      { length: TAXONOMY_TERMS_CODES_PER_QUERY + 1 },
      (_, i) => `AA-${String(i).padStart(5, '0')}`,
    );
    reference([
      term(HSIS_WRITER, codes[0], { en: 'First' }),
      term(HSIS_WRITER, codes[codes.length - 1], { en: 'Last' }),
    ]);

    const { names } = await service.lookup({
      resourceWriterIds: [HSIS_WRITER],
      codes,
    });

    expect(names).toEqual({
      [HSIS_WRITER]: { 'AA-00000': 'First', 'AA-05000': 'Last' },
    });
    const codeTerms = search.mock.calls.map(
      ([request]) => request.query.bool.filter[1].terms.code.length,
    );
    // 5,000 codes in three stored forms each.
    expect(Math.max(...codeTerms)).toBeLessThanOrEqual(15000);
  });
});
