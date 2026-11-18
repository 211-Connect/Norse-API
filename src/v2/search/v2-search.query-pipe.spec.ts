import { ValidationPipe } from '@nestjs/common';
import * as qs from 'qs';
import { V2SearchQueryDto } from './dto/v2-search-query.dto';

// The controller uses `new ValidationPipe({ transform: true, whitelist: true })`
// on @Query(). Express (qs, extended parser) turns the query string into an
// object first; the same two steps run here.
const pipe = new ValidationPipe({ transform: true, whitelist: true });
const run = (queryString: string): Promise<V2SearchQueryDto> =>
  pipe.transform(qs.parse(queryString), {
    type: 'query',
    metatype: V2SearchQueryDto,
  }) as Promise<V2SearchQueryDto>;

describe('GET /v2/search query: filters and v1 fields through the ValidationPipe (ISS-2499)', () => {
  it('keeps filters[languages]=Spanish', async () => {
    const dto = await run('query=food&filters[languages]=Spanish');
    expect(dto.filters).toEqual({ languages: 'Spanish' });
  });

  it('keeps filters[age_group][0]=a&filters[age_group][1]=b as an array', async () => {
    const dto = await run(
      'filters[age_group][0]=a&filters[age_group][1]=b&filters[languages]=Spanish',
    );
    expect(dto.filters).toEqual({
      age_group: ['a', 'b'],
      languages: 'Spanish',
    });
  });

  it('keeps a repeated bracket parameter filters[age_group][]=a&filters[age_group][]=b', async () => {
    const dto = await run('filters[age_group][]=a&filters[age_group][]=b');
    expect(dto.filters).toEqual({ age_group: ['a', 'b'] });
  });

  it('defaults filters to {} and taxonomy to []', async () => {
    const dto = await run('query=food');
    expect(dto.filters).toEqual({});
    expect(dto.taxonomy).toEqual([]);
    expect(dto.distance).toBe(0);
    expect(dto.limit).toBe(25);
    expect(dto.page).toBe(1);
    expect(dto.sort).toBe('relevance');
    expect(dto.age).toBeUndefined();
    expect(dto.geo_type).toBeUndefined();
    expect(dto.organization_id).toBeUndefined();
  });

  it('keeps organization_id, age (as a number), geo_type and taxonomy', async () => {
    const dto = await run(
      'organization_id=org-1&age=30&geo_type=proximity&taxonomy=BH-1800,BV-8900&distance=10',
    );
    expect(dto.organization_id).toBe('org-1');
    expect(dto.age).toBe(30);
    expect(dto.geo_type).toBe('proximity');
    expect(dto.taxonomy).toEqual(['BH-1800', 'BV-8900']);
    expect(dto.distance).toBe(10);
  });

  it('rejects a filters string (not an object) with a 400', async () => {
    await expect(run('filters=Spanish')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a bad geo_type and a negative age with a 400', async () => {
    await expect(run('geo_type=circle')).rejects.toMatchObject({ status: 400 });
    await expect(run('age=-1')).rejects.toMatchObject({ status: 400 });
  });

  it('whitelist drops an unknown parameter but keeps filters', async () => {
    const dto = await run('foo=bar&filters[languages]=Spanish');
    expect('foo' in dto).toBe(false);
    expect(dto.filters).toEqual({ languages: 'Spanish' });
  });

  it('query_type is not a v2 parameter: dropped, not forwarded', async () => {
    const dto = await run('query_type=text&query=food');
    expect('query_type' in dto).toBe(false);
  });
});
