import { useState } from 'react';
import { TextInput, type TextInputProps } from '@mantine/core';
import { maskPath } from '../../utils/maskPath';

interface MaskedPathInputProps
  extends Omit<TextInputProps, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

export function MaskedPathInput({
  value,
  onChange,
  ...props
}: MaskedPathInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      {...props}
      value={focused ? value : maskPath(value)}
      onChange={(e) => onChange(e.currentTarget.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}
