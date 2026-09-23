import React from 'react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function niceTime(iso) {
  return new Date(iso).toLocaleString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The day slot grid. Taken slots are visibly disabled (module 4 frontend
 * requirement). Clicking a free slot calls onPick. Stable keys are the
 * slot timestamps — they never collide within a grid.
 */
export default function SlotGrid({ slots, onPick }) {
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
              title={taken ? 'Already booked' : 'Book this slot'}
              onClick={() => onPick(slot)}
            >
              <span className="slot-time">{niceTime(slot.startsAt)}</span>
              <span className="slot-date">{new Date(slot.startsAt).getUTCDay() >= 0 ? DAY_NAMES[new Date(slot.startsAt).getDay()] : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}