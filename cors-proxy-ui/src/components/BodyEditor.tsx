import React from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export const BodyEditor: React.FC<Props> = ({ value, onChange, disabled }) => {
  const prettify = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {}
  };

  return (
    <div className="body-editor">
      <div className="body-toolbar">
        <span className="body-label">JSON Body</span>
        {!disabled && (
          <button onClick={prettify} className="btn-secondary btn-sm">Prettify</button>
        )}
      </div>
      <textarea
        className="body-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='{ "key": "value" }'
        disabled={disabled}
        spellCheck={false}
        rows={10}
      />
    </div>
  );
};