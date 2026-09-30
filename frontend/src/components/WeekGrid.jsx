import React from 'react';
import { timeLabel, weekdayLabel, localDateKey, dayLabel, dateTimeLabel } from '../lib/dates';
import SlotGrid from './SlotGrid';

/**
 * The week view: seven columns, Monday first.
 *
 * Monday-first is not cosmetic. The server numbers weekdays 0=Sunday..
 * 6=Saturday and derives slots from the doctor's `workingHours[].day`, so a
 * Sunday-first grid would put the doctor's Tuesday hours under the column
 * labelled Wednesday and the whole week would read as shifted by one.
 *
 * `byDay` maps a local YYYY-MM-DD key to that day's SlotDTO[] as returned by
 * GET /doctors/:id/slots?date=... — one request per day, issued by the parent,
 * so this component stays pure and needs no fetching of its own.
 */
export default function WeekGrid({ days, byDay, onPick, onSelectDay }) {
  return (
    <div className="week-grid" data-testid="week-grid">
      {days.map((key) => {
        const slots = byDay[key] ?? [];
        const isToday = key === localDateKey();
        return (
          <section
            key={key}
            className={`week-col${isToday ? ' week-col-today' : ''}${slots.length === 0 ? ' week-col-closed' : ''}`}
            aria-label={dayLabel(key)}
          >
            <header className="week-col-head">
              <span className="week-col-day">{weekdayLabel(key)}</span>
              <button type="button" className="week-col-date" onClick={() => onSelectDay?.(key)}>
                {dayLabel(key)}
              </button>
            </header>
            {slots.length === 0 ? (
              <p className="muted week-col-empty">Closed</p>
            ) : (
              <SlotGrid slots={slots} onPick={onPick} showDay={false} />
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Summary row for the week, shown above the grid: how many free slots each day
 * has, without expanding every column. Kept here so the day and week views can
 * never disagree about the same data.
 */
export function WeekSummary({ days, byDay }) {
  const total = days.reduce((sum, k) => sum + (byDay[k] ?? []).filter((s) => s.available).length, 0);
  return (
    <p className="muted week-summary" data-testid="week-summary">
      {total} free slot{total === 1 ? '' : 's'} this week
      {total === 0 ? ' — try another week' : ''}
    </p>
  );
}

/** Tooltip text for a slot, exported so the day grid and the week grid agree. */
export function slotTooltip(slot) {
  return `${dateTimeLabel(slot.startsAt)} — ${slot.available ? 'available' : 'already booked'}`;
}

export { timeLabel };
