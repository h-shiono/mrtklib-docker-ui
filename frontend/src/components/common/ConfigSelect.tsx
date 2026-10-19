import { Select, type SelectProps } from '@mantine/core';

type ConfigSelectItem<T extends string> =
  | T
  | { value: T; label: string; disabled?: boolean };

interface ConfigSelectProps<T extends string>
  extends Omit<SelectProps, 'value' | 'defaultValue' | 'onChange' | 'data' | 'allowDeselect'> {
  value: T;
  onChange: (value: NoInfer<T>) => void;
  data: readonly ConfigSelectItem<NoInfer<T>>[];
}

/**
 * Select bound to an enum config field. `T` is taken from `value`, so the
 * options and the handler are checked against the field's type.
 *
 * Deselecting is disabled: Mantine would report it as `null`, which no
 * config field accepts.
 */
export function ConfigSelect<T extends string>({
  onChange,
  data,
  ...props
}: ConfigSelectProps<T>) {
  return (
    <Select
      {...props}
      data={data as SelectProps['data']}
      allowDeselect={false}
      onChange={(v) => {
        if (v !== null) onChange(v as T);
      }}
    />
  );
}
