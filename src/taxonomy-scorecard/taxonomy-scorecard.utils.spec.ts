import {
  deriveNeedMetadata,
  getTaxonomyAncestors,
  getTaxonomyChildPrefix,
  getTaxonomyParentCode,
  getNextVersionId,
  isDirectTaxonomySibling,
  isChildOrSelfCode,
  isTaxonomyDescendantOrSelf,
} from './taxonomy-scorecard.utils';

describe('taxonomy-scorecard.utils', () => {
  it('should derive need metadata correctly', () => {
    const result = deriveNeedMetadata({
      'FO-200': 0.2,
      'EM-100': 0.8,
    });

    expect(result.top_category_code).toBe('EM-100');
    expect(result.top_weight).toBe(0.8);
    expect(result.need_categories_present).toEqual(['FO-200', 'EM-100']);
  });

  it('should omit zero-weight needs from weights and need_categories_present', () => {
    const result = deriveNeedMetadata({
      'FO-200': 0,
      'EM-100': 0.8,
    });

    expect(result.weights).toEqual({ 'EM-100': 0.8 });
    expect(result.need_categories_present).toEqual(['EM-100']);
    expect(result.top_category_code).toBe('EM-100');
    expect(result.top_weight).toBe(0.8);
  });

  it('should detect child or self taxonomy code', () => {
    expect(isChildOrSelfCode('BD', 'BD')).toBe(true);
    expect(isChildOrSelfCode('BD', 'BD-100')).toBe(true);
    expect(isChildOrSelfCode('BD-100', 'BD-100.2000')).toBe(true);
    expect(isChildOrSelfCode('OF-300', 'OF')).toBe(false);
  });

  it('should resolve hierarchy ancestors for mixed taxonomy levels', () => {
    expect(getTaxonomyAncestors('L')).toEqual(['L']);
    expect(getTaxonomyAncestors('LR')).toEqual(['L', 'LR']);
    expect(getTaxonomyAncestors('LR-8000')).toEqual(['L', 'LR', 'LR-8000']);
    expect(getTaxonomyAncestors('LR-8000.0500')).toEqual([
      'L',
      'LR',
      'LR-8000',
      'LR-8000.0500',
    ]);
    expect(getTaxonomyAncestors('LR-8000.0500-800')).toEqual([
      'L',
      'LR',
      'LR-8000',
      'LR-8000.0500',
      'LR-8000.0500-800',
    ]);
    expect(getTaxonomyAncestors('LR-8000.0500-800.05')).toEqual([
      'L',
      'LR',
      'LR-8000',
      'LR-8000.0500',
      'LR-8000.0500-800',
      'LR-8000.0500-800.05',
    ]);
  });

  it('should resolve parent code for all levels', () => {
    expect(getTaxonomyParentCode('L')).toBeNull();
    expect(getTaxonomyParentCode('LR')).toBe('L');
    expect(getTaxonomyParentCode('LR-8000')).toBe('LR');
    expect(getTaxonomyParentCode('LR-8000.0500')).toBe('LR-8000');
    expect(getTaxonomyParentCode('LR-8000.0500-800')).toBe('LR-8000.0500');
    expect(getTaxonomyParentCode('LR-8000.0500-800.05')).toBe(
      'LR-8000.0500-800',
    );
  });

  it('should detect structural descendants and direct siblings', () => {
    expect(isTaxonomyDescendantOrSelf('LR-8000', 'LR-8000.0500-800.05')).toBe(
      true,
    );
    expect(isTaxonomyDescendantOrSelf('LR-8000', 'LR-9000.0500')).toBe(false);

    expect(isDirectTaxonomySibling('LR-8000.0500', 'LR-8000.0600')).toBe(true);
    expect(isDirectTaxonomySibling('LR-8000.0500', 'LR-9000.0500')).toBe(false);
    expect(isDirectTaxonomySibling('LR-8000.0500', 'LR-8000.0500-800')).toBe(
      false,
    );
  });

  it('should compute child prefix for each hierarchy level', () => {
    expect(getTaxonomyChildPrefix('L')).toBe('L-');
    expect(getTaxonomyChildPrefix('LR')).toBe('LR-');
    expect(getTaxonomyChildPrefix('LR-8000')).toBe('LR-8000.');
    expect(getTaxonomyChildPrefix('LR-8000.0500')).toBe('LR-8000.0500-');
    expect(getTaxonomyChildPrefix('LR-8000.0500-800')).toBe(
      'LR-8000.0500-800.',
    );
  });

  it('should calculate next version id with metadata first', () => {
    expect(getNextVersionId(undefined, { next_version: 5 } as any)).toBe(5);
    expect(
      getNextVersionId({ '0': {} as any, '2': {} as any }, undefined),
    ).toBe(3);
    expect(getNextVersionId(undefined, undefined)).toBe(0);
  });
});
