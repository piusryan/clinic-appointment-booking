import React from 'react';
import {
  WEEKDAYS,
  sakaShort,
  sakaMonthName,
  monthCaption,
  indianOccasions,
  toISODate,
} from '../lib/indianCalendar.js';

/**
 * Month-view booking calendar with Indian (Saka) dates and occasion badges.
 * Each day is a real API summary: open/closed/holiday + free-slot count.
 */
export default function BookingCalendar({ month, days, selected, loading, onPrev, onNext, onToday, onSelectDay }) {
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const { greg, saka, sakaYear } = monthCaption(month);
  const todayStr = toISODate(new Date());

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m - 1, 1) ? new Date(y, m, 0).getDate() : 30;
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // week starts Monday
  const cells = lead + daysInMonth;
  const rows = Math.ceil(cells / 7);

  let cursor = 1;
  const grid = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < 7; c += 1) {
      const idx = r * 7 + c;
      if (idx < lead || cursor > daysInMonth) {
        row.push(null);
      } else {
        const dateStr = `${month}-${String(cursor).padStart(2, '0')}`;
        const info = byDate.get(dateStr) ?? { open: false, holiday: false, total: 0, available: 0 };
        row.push({ dateStr, num: cursor, info });
        cursor += 1;
      }
    }
    grid.push(row);
  }

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="btn btn-ghost cal-nav" onClick={onPrev} aria-label="Previous month">
          ‹
        </button>
        <div className="cal-title">
          <strong>{greg}</strong>
          <span className="cal-saka-title">
            {saka} · Saka {sakaYear || saka}
          </span>
        </div>
        <button type="button" className="btn btn-ghost cal-nav" onClick={onNext} aria-label="Next month">
          ›
        </button>
        <button type="button" className="btn cal-today" onClick={onToday}>
          Today
        </button>
      </div>

      <div className="cal-weekdays">
        {WEEKDAYS.map((wd) => (
          <span key={wd} className={wd === 'Sun' ? 'cal-sun' : ''}>{wd}</span>
        ))}
      </div>

      <div className={loading ? 'cal-grid cal-loading' : 'cal-grid'}>
        {grid.map((row, ri) => (
          <React.Fragment key={ri}>
            {row.map((cell, ci) => {
              if (!cell) return <span key={ci} className="cal-cell cal-empty" />;
              const { dateStr, num, info } = cell;
              const isPast = dateStr < todayStr;
              const occasions = indianOccasions(dateStr);
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selected;
              const cls = [
                'cal-cell',
                isToday ? 'cal-today-cell' : '',
                isSelected ? 'cal-selected' : '',
                isPast ? 'cal-past' : '',
                info.holiday ? 'cal-holiday' : '',
                !info.open ? 'cal-off' : '',
                info.open && info.available === 0 ? 'cal-full' : '',
              ]
                .filter(Boolean)
                .join(' ');

              const status = info.holiday
                ? 'Holiday'
                : !info.open
                  ? 'Off'
                  : info.available > 0
                    ? `${info.available} free`
                    : 'Full';

              return (
                <button
                  key={ci}
                  type="button"
                  className={cls}
                  disabled={isPast}
                  onClick={() => onSelectDay(dateStr)}
                  title={[dateStr, ...occasions, status].filter(Boolean).join(' · ')}
                >
                  <span className="cal-day-num">{num}</span>
                  <span className="cal-day-saka">{sakaShort(dateStr)}</span>
                  {occasions.length ? (
                    <span className="cal-occ">
                      {occasions.slice(0, 2).join(', ')}
                      {occasions.length > 2 ? ` +${occasions.length - 2}` : ''}
                    </span>
                  ) : null}
                  <span className={`cal-status${info.holiday ? ' cal-status-holiday' : ''}${info.open && info.available === 0 ? ' cal-status-full' : ''}`}>
                    {status}
                  </span>
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {loadLabel(days, sakaMonthName(month), loading)}
    </div>
  );
}

function loadLabel(days, sakaMonth, loading) {
  if (loading) return <p className="cal-foot">Loading availability…</p>;
  const open = (days ?? []).filter((d) => d.open);
  const free = open.reduce((n, d) => n + d.available, 0);
  const holidays = (days ?? []).filter((d) => d.holiday).length;
  return (
    <p className="cal-foot">
      {open.length} working day{open.length === 1 ? '' : 's'} · {free} free slot{free === 1 ? '' : 's'} · {holidays}{' '}
      closure{holidays === 1 ? '' : 's'}
    </p>
  );
}