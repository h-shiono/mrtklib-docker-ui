import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FailureCause } from './FailureCause';
import { renderWithMantine } from '../../test/render';

describe('FailureCause', () => {
  it('shows the cause with credentials masked', () => {
    renderWithMantine(<FailureCause cause="Start failed: cannot open ntrip://user:secret@caster:2101/MOUNT" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Start failed: cannot open ntrip://user:***@caster:2101/MOUNT');
    expect(alert.innerHTML).not.toContain('secret');
  });
  it('renders nothing without a cause', () => {
    renderWithMantine(<FailureCause cause={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
