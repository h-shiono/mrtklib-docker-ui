import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfigSelect } from './ConfigSelect';
import { renderWithMantine } from '../../test/render';

describe('ConfigSelect', () => {
  it('re-picking the selected option does not report null', async () => {
    const onChange = vi.fn<(v: 'a' | 'b') => void>();
    const user = userEvent.setup();
    renderWithMantine(
      <ConfigSelect<'a' | 'b'>
        aria-label="field"
        value="a"
        onChange={onChange}
        data={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'field' });

    await user.click(input);
    await user.click(await screen.findByRole('option', { name: 'Alpha' }));
    expect(onChange).not.toHaveBeenCalledWith(null);
    expect(input).toHaveValue('Alpha');

    await user.click(input);
    await user.click(await screen.findByRole('option', { name: 'Beta' }));
    expect(onChange).toHaveBeenLastCalledWith('b');
  });
});
