import React from 'react';

export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="banner banner-error" role="alert">
      <span>{error}</span>
      {onDismiss ? (
        <button className="banner-dismiss" type="button" onClick={onDismiss} aria-label="dismiss">
          ×
        </button>
      ) : null}
    </div>
  );
}