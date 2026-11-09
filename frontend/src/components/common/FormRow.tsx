import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import {
  Autocomplete,
  Box,
  NumberInput,
  PasswordInput,
  Select,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { FORM_LABEL_GAP, FORM_LABEL_WIDTH, FORM_ROW_HEIGHT } from '../../utils/formLayout';
import { FONT_SIZE } from '../../utils/typography';
import { ConfigNumberInput } from './ConfigNumberInput';
import { ConfigSelect } from './ConfigSelect';
import { MaskedPathInput } from './MaskedPathInput';

const LABELABLE = new Set<unknown>([
  Autocomplete, ConfigNumberInput, ConfigSelect, MaskedPathInput,
  NumberInput, PasswordInput, Select, Switch, Textarea, TextInput,
]);

type Labelable = ReactElement<{ id?: string }>;

function isLabelable(node: ReactNode): node is Labelable {
  return isValidElement(node) && LABELABLE.has(node.type);
}

/** One form row: label left, control filling the rest, optional trailing
 *  buttons. A single input is tied to the label; rows holding several controls
 *  render the label as plain text. */
export function FormRow({ label, children, trailing, align = 'center' }: {
  label: ReactNode;
  children: ReactNode;
  /** Browse, remove and similar buttons after the control. */
  trailing?: ReactNode;
  /** `flex-start` for rows taller than one input. */
  align?: 'center' | 'flex-start';
}) {
  const generatedId = useId();
  const labelable = isLabelable(children) && typeof label === 'string';
  const id = labelable ? (children.props.id ?? generatedId) : undefined;
  const labelProps = id ? ({ component: 'label', htmlFor: id } as const) : ({ component: 'div' } as const);

  return (
    <Box style={{ display: 'flex', alignItems: align, gap: FORM_LABEL_GAP, minHeight: FORM_ROW_HEIGHT, minWidth: 0 }}>
      <Text
        {...labelProps}
        c="dimmed"
        style={{
          width: FORM_LABEL_WIDTH,
          flexShrink: 0,
          minHeight: FORM_ROW_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          fontSize: FONT_SIZE.label,
        }}
      >
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>
        {labelable ? cloneElement(children, { id }) : children}
      </Box>
      {trailing && (
        <Box style={{ display: 'flex', alignItems: 'center', gap: FORM_LABEL_GAP, flexShrink: 0, minHeight: FORM_ROW_HEIGHT }}>
          {trailing}
        </Box>
      )}
    </Box>
  );
}
