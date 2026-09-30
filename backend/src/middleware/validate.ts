import type { NextFunction, Request, Response } from 'express';
import { badRequest } from '../utils/errors';

/** Declarative validation. Rules live here, not as `if`s in routes/controllers. */

interface FieldRule {
  field: string;
  test: (v: unknown) => string | undefined;
}
type Rule = FieldRule | ((v: unknown) => string | undefined);

const fieldRule = (field: string, test: (v: unknown) => string | undefined): FieldRule => ({ field, test });

export const required = (field: string, label = field): Rule =>
  fieldRule(field, (v) => (v === undefined || v === null || v === '' ? `${label} is required` : undefined));

export const isString = (field: string, label = field): Rule =>
  fieldRule(field, (v) => (typeof v === 'string' ? undefined : `${label} must be a string`));

export const isEmail = (field: string): Rule =>
  fieldRule(field, (v) =>
    typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? undefined : `${field} must be a valid email`
  );

export const minLen = (field: string, n: number): Rule =>
  fieldRule(field, (v) => (typeof v === 'string' && v.length >= n ? undefined : `${field} must be at least ${n} chars`));

export const isEnum = (field: string, values: readonly string[]): Rule =>
  fieldRule(field, (v) =>
    typeof v === 'string' && (values as readonly string[]).includes(v) ? undefined : `${field} must be one of ${values.join(', ')}`
  );

export const isIsoDate = (field: string): Rule =>
  fieldRule(field, (v) =>
    typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? undefined : `${field} must be an ISO datetime`
  );

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date: 2026-02-30 and 2026-13-45 are rejected. */
function isRealCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through UTC: Date normalises 2026-02-30 to 2026-03-02, so a
  // mismatch is exactly the "this day does not exist" case.
  const probe = new Date(Date.UTC(y, month - 1, day));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export const isCalendarDate = (field: string): Rule =>
  fieldRule(field, (v) =>
    typeof v === 'string' && isRealCalendarDate(v) ? undefined : `${field} must be a YYYY-MM-DD date`
  );

export const isObjectId = (field: string): Rule =>
  fieldRule(field, (v) => (typeof v === 'string' && /^[a-f\d]{24}$/i.test(v) ? undefined : `${field} must be a valid id`));

export const isYearMonth = (field: string): Rule =>
  fieldRule(field, (v) =>
    typeof v === 'string' && /^(\d{4})-(0[1-9]|1[0-2])$/.test(v) ? undefined : `${field} must be a YYYY-MM month`
  );

/** Wrap any field rule so an absent value is allowed (query filters, PATCH patches). */
export const optional = (rule: Rule): Rule => {
  if (typeof rule === 'function') {
    return (v: unknown) => (v === undefined || v === null || v === '' ? undefined : rule(v));
  }
  const test = rule.test;
  return { field: rule.field, test: (v) => (v === undefined || v === null || v === '' ? undefined : test(v)) };
};

export const bodyHas = (fields: string[]): Rule =>
  (v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'body must be an object';
    for (const f of fields) {
      if ((v as Record<string, unknown>)[f] === undefined) return `Missing field: ${f}`;
    }
    return undefined;
  };

/** validate(source, ...rules) -> middleware. First failures -> 400, standard shape. */
export function validate(
  source: 'body' | 'params' | 'query',
  ...rules: Rule[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const value = req[source];
    const errors: string[] = [];
    for (const rule of rules) {
      let msg: string | undefined;
      if (typeof rule === 'function') {
        msg = rule(value);
      } else {
        msg = rule.test((value as Record<string, unknown> | undefined)?.[rule.field]);
      }
      if (msg) errors.push(msg);
    }
    if (errors.length > 0) return next(badRequest(errors.join('; ')));
    next();
  };
}