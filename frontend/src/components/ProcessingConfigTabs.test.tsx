import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingConfigPanel } from './ProcessingConfigTabs';
import { DEFAULT_MRTK_POST_CONFIG } from '../types/mrtkPostConfig';
import { renderWithMantine } from '../test/render';

const execution = {
  roverFile: '/workspace/rover.obs', onRoverFileChange: vi.fn(),
  baseFile: '', onBaseFileChange: vi.fn(),
  navFile: '/workspace/nav.nav', onNavFileChange: vi.fn(),
  correctionFiles: [], onCorrectionFilesChange: vi.fn(),
  outputFile: '/workspace/out.pos', onOutputFileChange: vi.fn(),
  needsBase: false, onQcPreview: vi.fn(), roverFileValid: true,
};

function renderPanel(readOnly: boolean) {
  const onConfigChange = vi.fn();
  renderWithMantine(
    <ProcessingConfigPanel
      config={DEFAULT_MRTK_POST_CONFIG}
      onConfigChange={onConfigChange}
      execution={execution}
      readOnly={readOnly}
    />,
  );
  return onConfigChange;
}

describe('ProcessingConfigPanel read-only (#203)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    execution.onRoverFileChange.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('takes no edits, says why, and keeps the rail usable', async () => {
    const user = userEvent.setup();
    const onConfigChange = renderPanel(true);
    expect(screen.getByText('Locked while running. Stop to edit.')).toBeInTheDocument();

    const rover = screen.getByDisplayValue('/workspace/rover.obs');
    expect(rover).toBeDisabled();
    await user.type(rover, 'x');
    expect(execution.onRoverFileChange).not.toHaveBeenCalled();

    // The rail and its filter are outside the lock.
    await user.type(screen.getByRole('textbox', { name: 'Filter sections' }), 'mo');
    await user.click(screen.getByRole('button', { name: 'Mode' }));
    const mode = screen.getByRole('textbox', { name: 'Positioning Mode' });
    expect(mode).toBeDisabled();
    await user.click(mode);
    expect(screen.queryByRole('option')).toBeNull();
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('drops a write from a modal opened before the lock', async () => {
    // The SNR mask and signal modals render outside the fieldset, and a run
    // can start (from another tab) while one is open.
    const onConfigChange = vi.fn();
    function Harness() {
      const [readOnly, setReadOnly] = useState(false);
      return (
        <>
          <button type="button" hidden onClick={() => setReadOnly(true)}>lock</button>
          <ProcessingConfigPanel config={DEFAULT_MRTK_POST_CONFIG} onConfigChange={onConfigChange} execution={execution} readOnly={readOnly} />
        </>
      );
    }
    renderWithMantine(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mode' }));
    await user.click(screen.getByRole('button', { name: 'Edit SNR Mask...' }));
    // A direct click: the run starts elsewhere, the modal stays open.
    fireEvent.click(screen.getByText('lock'));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(onConfigChange).not.toHaveBeenCalled();
  });

  it('is editable when not running', async () => {
    const user = userEvent.setup();
    renderPanel(false);
    expect(screen.queryByText('Locked while running. Stop to edit.')).toBeNull();
    await user.type(screen.getByDisplayValue('/workspace/rover.obs'), 'x');
    expect(execution.onRoverFileChange).toHaveBeenCalled();
  });
});
