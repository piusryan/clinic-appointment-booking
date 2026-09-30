import React from 'react';
import { timeLabel, weekdayLabel, localDateKey, dateTimeLabel } from '../lib/dates';

/**
 * The day slot grid. Taken slots are visibly disabled (module 4 frontend
 * requirement). Clicking a free slot calls onPick. Stable keys are the slot
 * timestamps — they never collide within a grid.
 *
 * TIMEZONES. `startsAt` is an ISO UTC instant and the server derives it from the
 * CLINIC's timezone (Europe/Dublin). It is rendered here in the VIEWER's local
 * zone, which is the only honest option for an absolute moment: a viewer in
 * Tokyo correctly sees a Dublin 09:00 slot as 17:00. The clinic's own wall
 * clock is never reconstructed in the browser, because the browser does not
 * know it — deriving it from the date alone (as this component used to, with
 * `getUTCDay() >= 0 ? DAY_NAMES[getDay()]`) mixed a UTC weekday test with a
 * local weekday index and produced a label that was wrong for most of the day
 * and for every user not on GMT.
 */
export default function SlotGrid({ slots, onPick, showDay = true }) {
  if (slots.length === 0) {
    return <p className="muted">No availability on this day (closed or fully booked).</p>;
  }

  return (
    <ul className="slot-grid" data-testid="slot-grid">
      {slots.map((slot) => {
        const taken = !slot.available;
        return (
          <li key={slot.startsAt}>
            <button
              type="button"
              className={`slot${taken ? ' slot-taken' : ' slot-free'}`}
              disabled={taken}
              aria-label={`${timeLabel(slot.startsAt)} on ${weekdayLabel(localDateKey(new Date(slot.startsAt)))}, ${
                taken ? 'already booked' : 'available'
              }`}
              title={`${dateTimeLabel(slot.startsAt)} — ${taken ? 'already booked' : 'available'}`}
              onClick={() => onPick(slot)}
            >
              <span className="slot-time">{timeLabel(slot.startsAt)}</span>
              {showDay ? <span className="slot-date">{weekdayLabel(localDateKey(new Date(slot.startsAt)))}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
