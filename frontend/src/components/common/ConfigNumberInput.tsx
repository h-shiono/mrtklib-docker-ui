import { useState } from 'react';
import { NumberInput, type NumberInputProps } from '@mantine/core';

interface ConfigNumberInputProps
  extends Omit<NumberInputProps, 'value' | 'defaultValue' | 'onChange'> {
  value: number;
  onChange: (value: number) => void;
}

/**
 * NumberInput bound to a numeric config field.
 *
 * Mantine passes the raw string for an empty or partial entry ('', '-',
 * '1.'). Such a string stays a local draft and the field keeps its last
 * number instead of becoming 0; on blur the input shows that number again.
 */
export function ConfigNumberInput({
  value,
  onChange,
  onBlur,
  ...props
}: ConfigNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <NumberInput
      {...props}
      value={draft ?? value}
      onChange={(v) => {
        if (typeof v === 'number') {
          setDraft(null);
          onChange(v);
          return;
        }
        setDraft(v);
        // '1.' and '1.50' are complete numbers Mantine reports as strings
        const n = v.trim() === '' ? NaN : Number(v);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
