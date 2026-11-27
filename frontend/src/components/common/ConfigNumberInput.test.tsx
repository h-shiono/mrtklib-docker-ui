import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfigNumberInput } from './ConfigNumberInput';
import { renderWithMantine } from '../../test/render';

/** A config field: the saved number lives in the parent, as in the forms. */
function Field({
  initial,
  onSaved,
  ...props
}: {
  initial: number;
  onSaved: (v: number) => void;
  min?: number;
  max?: number;
  decimalScale?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ConfigNumberInput
        aria-label="field"
        value={value}
        onChange={(v) => {
          setValue(v);
          onSaved(v);
        }}
        {...props}
      />
      <output data-testid="saved">{String(value)}</output>
      <button type="button">elsewhere</button>
    </>
  );
}

function setup(initial: number, props: { min?: number; max?: number; decimalScale?: number } = {}) {
  const onSaved = vi.fn<(v: number) => void>();
  const user = userEvent.setup();
  renderWithMantine(<Field initial={initial} onSaved={onSaved} {...props} />);
  const input = screen.getByRole('textbox', { name: 'field' }) as HTMLInputElement;
  const saved = () => screen.getByTestId('saved').textContent;
  const blur = () => user.click(screen.getByRole('button', { name: 'elsewhere' }));
  return { user, input, saved, blur, onSaved };
}

describe('ConfigNumberInput', () => {
  it('clear + blur keeps the saved number and shows it again', async () => {
    const { user, input, saved, blur, onSaved } = setup(15);
    await user.clear(input);
    expect(input.value).toBe('');
    expect(onSaved).not.toHaveBeenCalledWith(0);
    await blur();
    expect(saved()).toBe('15');
    expect(input.value).toBe('15');
  });

  it('erasing 90 digit by digit, then blurring, restores 90 (not 9)', async () => {
    const { user, input, saved, blur } = setup(90);
    await user.click(input);
    await user.keyboard('{End}{Backspace}');
    expect(saved()).toBe('9');
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('');
    await blur();
    expect(saved()).toBe('90');
    expect(input.value).toBe('90');
  });

  it('a lone "-" stays a draft and blur restores the value', async () => {
    const { user, input, saved, blur, onSaved } = setup(3);
    await user.clear(input);
    await user.type(input, '-');
    expect(input.value).toBe('-');
    expect(onSaved).not.toHaveBeenCalledWith(0);
    expect(onSaved).not.toHaveBeenCalledWith(NaN);
    await blur();
    expect(saved()).toBe('3');
    expect(input.value).toBe('3');
  });

  it('"1." and "1.50" commit as numbers', async () => {
    const { user, input, saved, blur, onSaved } = setup(0);
    await user.clear(input);
    await user.type(input, '1.');
    expect(input.value).toBe('1.');
    expect(saved()).toBe('1');
    await user.type(input, '50');
    expect(input.value).toBe('1.50');
    expect(saved()).toBe('1.5');
    await blur();
    expect(saved()).toBe('1.5');
    for (const [v] of onSaved.mock.calls) expect(typeof v).toBe('number');
  });

  it('typing a new value commits it', async () => {
    const { user, input, saved, blur } = setup(10);
    await user.clear(input);
    await user.type(input, '42');
    await blur();
    expect(saved()).toBe('42');
    expect(input.value).toBe('42');
  });

  it('blur clamps to min / max and commits the clamped number', async () => {
    const { user, input, saved, blur } = setup(10, { min: 0, max: 90 });
    await user.clear(input);
    await user.type(input, '120');
    await blur();
    expect(saved()).toBe('90');
    expect(input.value).toBe('90');

    await user.clear(input);
    await user.type(input, '-5');
    await blur();
    expect(saved()).toBe('0');
    expect(input.value).toBe('0');
  });

  it('arrow keys commit at once', async () => {
    const { user, input, saved } = setup(5);
    await user.click(input);
    await user.keyboard('{ArrowUp}');
    expect(saved()).toBe('6');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(saved()).toBe('4');
  });
});
