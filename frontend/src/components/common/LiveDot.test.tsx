import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveDot } from './LiveDot';
import { renderWithMantine } from '../../test/render';

describe('LiveDot', () => {
  it('names the screen and its state, not by colour alone', () => {
    renderWithMantine(<LiveDot name="Streams" live="running" />);
    const dot = screen.getByRole('img', { name: 'Streams: running' });
    expect(dot).toHaveAttribute('title', 'Streams: running');
    expect(dot.style.background).toBe('var(--status-ok)');
  });
  it('is blue while starting', () => {
    renderWithMantine(<LiveDot name="Real-time" live="starting" />);
    expect(screen.getByRole('img', { name: 'Real-time: starting' }).style.background).toBe('var(--status-starting)');
  });
  it('renders nothing without a live process', () => {
    renderWithMantine(<LiveDot name="Tools" live={null} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
