import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { V2SearchEnabledGuard } from './v2-search-enabled.guard';

const make = (value: unknown) => {
  const get = jest.fn(() => value);
  const guard = new V2SearchEnabledGuard({ get } as unknown as ConfigService);
  return { guard, get };
};

describe('V2SearchEnabledGuard', () => {
  it('the exact string true lets the request through', () => {
    const { guard, get } = make('true');
    expect(guard.canActivate()).toBe(true);
    expect(get).toHaveBeenCalledWith('V2_SEARCH_ENABLED');
  });

  it.each([
    undefined,
    '',
    'false',
    'TRUE',
    'True',
    '1',
    'yes',
    ' true',
    'true ',
    true,
  ])('env %p: 404', (value) => {
    const { guard } = make(value);
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});
