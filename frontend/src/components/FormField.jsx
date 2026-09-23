import React, { useState } from 'react';

/**
 * A controlled field: state lifted to the parent via `value` + `onChange`,
 * with client-side validation on blur (module 8 deliverable).
 */
export default function FormField({ label, name, type = 'text', value, onChange, validate, placeholder, required }) {
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);

  const runValidate = (val) => {
    const e = validate ? validate(val) : null;
    setError(e);
    return e;
  };

  return (
    <label className={`field ${error ? 'field-invalid' : ''}`}>
      <span className="field-label">
        {label}
        {required ? <span className="req"> *</span> : null}
      </span>
      <input
        type={type}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          if (touched) runValidate(e.target.value);
        }}
        onBlur={(e) => {
          setTouched(true);
          runValidate(e.target.value);
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}