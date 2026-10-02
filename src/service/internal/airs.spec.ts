import {
  airsParent,
  buildAirsTreeFromPathCounts,
  expandAirsCode,
  isAirsCode,
} from './airs';

describe('AIRS code structure (port of ServiceNet sharing-contracts/airs.ts)', () => {
  it('expands a code to itself and every ancestor, nearest first', () => {
    expect(expandAirsCode('BD-1800.8200-250')).toEqual([
      'BD-1800.8200-250',
      'BD-1800.8200',
      'BD-1800',
      'BD',
    ]);
  });

  it('cuts only at separators, so BD-18 is never an ancestor of BD-1800', () => {
    expect(expandAirsCode('BD-1800')).not.toContain('BD-18');
    expect(airsParent('BD-1800')).toBe('BD');
  });

  it('keeps a free-text label whole instead of cutting it into branches', () => {
    expect(isAirsCode('Serbo-Croatian')).toBe(false);
    expect(expandAirsCode('Serbo-Croatian')).toEqual(['Serbo-Croatian']);
    expect(airsParent('Serbo-Croatian')).toBeNull();
  });

  it('strips a trailing separator from the key', () => {
    expect(expandAirsCode('BD-1800.')).toEqual(['BD-1800', 'BD']);
  });

  it('builds tree nodes from expanded path counts, flagging uncoded nodes', () => {
    const tree = buildAirsTreeFromPathCounts(
      [
        { code: 'BD-1800', recordCount: 3 },
        { code: 'BD', recordCount: 3 },
      ],
      new Set(['BD-1800']),
    );
    expect(tree).toEqual([
      { code: 'BD', parentCode: null, recordCount: 3, synthesized: true },
      { code: 'BD-1800', parentCode: 'BD', recordCount: 3, synthesized: false },
    ]);
  });
});
