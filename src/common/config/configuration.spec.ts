import { envFlag } from './configuration';

describe('envFlag', () => {
  it.each([
    [undefined, true, true],
    ['', true, true],
    ['true', true, true],
    ['TRUE', true, true],
    ['false', true, false],
    ['FALSE', true, false],
    ['False', true, false],
    [' false', true, true],
    ['false ', true, true],
    ['0', true, true],
    [undefined, false, false],
    ['', false, false],
    ['true', false, true],
    ['TRUE', false, true],
    ['True', false, true],
    [' true', false, false],
    ['true ', false, false],
    ['false', false, false],
    ['1', false, false],
    ['on', false, false],
  ])('value %p, default on %p -> %p', (value, defaultOn, expected) => {
    expect(envFlag(value, defaultOn)).toBe(expected);
  });
});
