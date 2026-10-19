import { useRef, useState } from 'react';
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
 * '1.'). Such a string stays a local draft instead of becoming 0. If the
 * field is left empty or partial, blur restores the value it had on focus.
 */
export function ConfigNumberInput({
  value,
  onChange,
  onFocus,
  onBlur,
  ...props
}: ConfigNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Value when the field gained focus. Erasing '90' digit by digit commits
  // 9 on the way, so an entry left empty must go back to this, not to the
  // last committed number.
  const focusValue = useRef(value);
  const invalid = useRef(false);

  return (
    <NumberInput
      {...props}
      value={draft ?? value}
      onChange={(v) => {
        if (typeof v === 'number') {
          invalid.current = false;
          setDraft(null);
          onChange(v);
          return;
        }
        setDraft(v);
        // '1.' and '1.50' are complete numbers Mantine reports as strings
        const n = v.trim() === '' ? NaN : Number(v);
        invalid.current = !Number.isFinite(n);
        if (!invalid.current) onChange(n);
      }}
      onFocus={(e) => {
        focusValue.current = value;
        invalid.current = false;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (invalid.current && value !== focusValue.current) {
          onChange(focusValue.current);
        }
        invalid.current = false;
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
