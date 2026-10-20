// Load every schema first, as the app does: a schema decorated with
// `@Prop(Number)` once set `Number.type = []` globally, which made the
// `[Number]` paths below arrays of arrays (`weekdays: [[1, 3, 5]]`).
import './resource.schema';
import { model } from 'mongoose';
import { PrintableDirectoryDeliverySchema } from './printable-directory-delivery.schema';

describe('PrintableDirectoryDeliverySchema', () => {
  it('keeps the global Number constructor untouched', () => {
    expect((Number as unknown as { type?: unknown }).type).toBeUndefined();
  });

  it.each(['weekdays', 'monthDays'])(
    'stores %s as a flat number array',
    (path) => {
      const Delivery = model(
        'DeliverySchemaSpec',
        PrintableDirectoryDeliverySchema,
      );
      const delivery = new Delivery({ [path]: [1, 16] });

      expect(delivery.toBSON()[path]).toEqual([1, 16]);
    },
  );
});
