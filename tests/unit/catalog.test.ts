import { describe, it, expect } from 'vitest';
import { isOpen, hoursSchema } from '@cravecart/contracts';
describe('India operating calendars', () => {
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
