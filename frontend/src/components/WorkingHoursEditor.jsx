import React from 'react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = [0, 1, 2, 3, 4, 5, 6];

const emptyBlock = { day: 1, start: '09:00', end: '17:00' };

/**
 * Working-hours editor — one row per open day (day + start + end time),
 * add/remove rows, ordered by weekday. Controlled component:
 * value = WorkingHours[], onChange = (next) => void.
 */
export default function WorkingHoursEditor({ value = [], onChange }) {
  const setBlock = (index, patch) => {
    const next = value.map((b, i) => (i === index ? { ...b, ...patch } : b));
    onChange(sortBlocks(next));
  };

  const addBlock = () => {
    const used = new Set(value.map((b) => b.day));
    const next = DAYS.find((d) => !used.has(d)) ?? 0;
    onChange(sortBlocks([...value, { ...emptyBlock, day: next }]));
  };

  const removeBlock = (index) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const sortBlocks = (blocks) =>
    [...blocks].sort((a, b) => a.day - b.day);

  return (
    <div className="wh-editor">
      {value.length === 0 ? (
        <p className="muted wh-empty">No working days set — add one.</p>
      ) : (
        <div className="wh-rows">
          {value.map((block, i) => (
            <div className="wh-row" key={`${block.day}-${i}`}>
              <label className="wh-cell">
                <span className="field-label">Day</span>
                <select
                  value={block.day}
                  onChange={(e) => setBlock(i, { day: Number(e.target.value) })}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d} disabled={value.some((b, j) => b.day === d && j !== i)}>
                      {DAY_NAMES[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wh-cell">
                <span className="field-label">Open</span>
                <input
                  type="time"
                  value={block.start}
                  onChange={(e) => setBlock(i, { start: e.target.value })}
                />
              </label>
              <label className="wh-cell">
                <span className="field-label">Close</span>
                <input
                  type="time"
                  value={block.end}
                  onChange={(e) => setBlock(i, { end: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn btn-sm btn-danger wh-remove"
                aria-label="Remove day"
                onClick={() => removeBlock(i)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-sm btn-ghost wh-add" onClick={addBlock}>
        + Add working day
      </button>
    </div>
  );
}
