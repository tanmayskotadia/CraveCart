import { describe, it, expect } from 'vitest';
import { isOpen, hoursSchema, periodQuerySchema, periodBounds } from '@cravecart/contracts';
describe('India operating calendars', () => {
  it('maps a single India reporting day to an exclusive UTC interval', () => {
    expect(periodBounds(periodQuerySchema.parse({ from: '2026-10-25', to: '2026-10-25' }))).toEqual(
      { from: '2026-10-24T18:30:00.000Z', to: '2026-10-25T18:30:00.000Z' },
    );
  });
  it('rejects impossible dates, reversed ranges and unbounded report queries', () => {
    for (const value of [
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-10-26', to: '2026-10-25' },
      { from: '2026-01-01', to: '2026-12-31' },
    ])
      expect(periodQuerySchema.safeParse(value).success).toBe(false);
  });
  it('uses the India weekday across UTC midnight boundaries and excludes closing time', () => {
    const hours = [{ day: 1, openMinute: 0, closeMinute: 60 }];
    expect(isOpen(hours, new Date('2026-10-25T18:45:00.000Z'))).toBe(true);
    expect(isOpen(hours, new Date('2026-10-25T19:30:00.000Z'))).toBe(false);
  });
  it('honors closed dates in India time and fails closed without hours', () => {
    expect(
      isOpen([{ day: 1, openMinute: 0, closeMinute: 1440 }], new Date('2026-10-25T18:45:00.000Z'), [
        { date: '2026-10-26', closed: true },
      ]),
    ).toBe(false);
    expect(isOpen([], new Date())).toBe(false);
  });
  it('rejects overlapping or unsplit overnight slots but accepts split operating days', () => {
    expect(
      hoursSchema.safeParse([
        { day: 1, openMinute: 600, closeMinute: 900 },
        { day: 1, openMinute: 800, closeMinute: 1000 },
      ]).success,
    ).toBe(false);
    expect(hoursSchema.safeParse([{ day: 1, openMinute: 1200, closeMinute: 120 }]).success).toBe(
      false,
    );
    expect(
      hoursSchema.safeParse([
        { day: 1, openMinute: 1200, closeMinute: 1440 },
        { day: 2, openMinute: 0, closeMinute: 120 },
      ]).success,
    ).toBe(true);
  });
});
