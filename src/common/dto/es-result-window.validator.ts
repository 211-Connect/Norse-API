import { ValidationArguments } from 'class-validator';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Elasticsearch's default `max_result_window`: ES can only return the first
 * 10000 hits per index — `from + size` beyond that is rejected with a
 * `search_phase_execution` failure (and `from` past the int32 range does not
 * even parse) — both of which would surface as an unhandled 500 instead of a
 * 400.
 */
export const ES_MAX_RESULT_WINDOW = 10_000;

const readLimit = (object: unknown): unknown =>
  object && typeof object === 'object' && 'limit' in object
    ? object.limit
    : undefined;

/**
 * Cross-field pagination guard: validates that `page * limit` (which equals
 * Elasticsearch's `from + size`) stays within the result window. Applied to
 * the `page` property; expects a sibling `limit` (falls back to the search
 * default of 25 when absent).
 */
@ValidatorConstraint({ name: 'isWithinMaxResultWindow', async: false })
export class IsWithinMaxResultWindowConstraint
  implements ValidatorConstraintInterface
{
  validate(page: number, args: ValidationArguments): boolean {
    if (!Number.isFinite(page) || page <= 0) {
      // @IsInt / @Min report malformed page input themselves.
      return true;
    }

    const limit = Number(readLimit(args.object) ?? 25);
    if (!Number.isFinite(limit) || limit <= 0) {
      // limit's own validators (@Min/@Max/@IsInt) report it instead.
      return true;
    }

    // ES window check: from + size = (page - 1) * limit + limit = page * limit.
    return page * limit <= ES_MAX_RESULT_WINDOW;
  }

  defaultMessage(args: ValidationArguments): string {
    return (
      `page ${args.value} with limit ${readLimit(args.object) ?? 25} exceeds ` +
      `the maximum result window of ${ES_MAX_RESULT_WINDOW} — ` +
      `Elasticsearch can only return the first ${ES_MAX_RESULT_WINDOW} hits, ` +
      `so page * limit must stay <= ${ES_MAX_RESULT_WINDOW}`
    );
  }
}
