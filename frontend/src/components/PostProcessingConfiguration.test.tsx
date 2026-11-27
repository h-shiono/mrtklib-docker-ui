import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostProcessingConfiguration } from './PostProcessingConfiguration';
import type { ProcessState } from '../utils/status';
import { renderWithMantine } from '../test/render';

function renderWith(processStatus: ProcessState, isLoading = false) {
  const onStop = vi.fn();
  renderWithMantine(
    <PostProcessingConfiguration
      onConfigChange={vi.fn()}
      roverFile="/workspace/rover.obs" onRoverFileChange={vi.fn()}
      baseFile="" onBaseFileChange={vi.fn()}
      navFile="/workspace/nav.nav" onNavFileChange={vi.fn()}
      correctionFiles={[]} onCorrectionFilesChange={vi.fn()}
      outputFile="/workspace/out.pos" onOutputFileChange={vi.fn()}
      needsBase={false}
      processStatus={processStatus}
      isLoading={isLoading}
      onExecute={vi.fn()}
      onStop={onStop}
      onExportConf={vi.fn()}
      onQcPreview={vi.fn()}
      roverFileValid
    />,
  );
  return onStop;
}

const button = (name: string) => screen.queryByRole('button', { name: new RegExp(`^${name}$`) });

describe('PP Execute / Stop (#234)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('running: Stop can be pressed', () => {
    const onStop = renderWith('running');
    const stop = button('Stop')!;
    expect(stop).toBeEnabled();
    stop.click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(button('Execute')).toBeNull();
  });

  it('running before the job id arrives: Stop is disabled', () => {
    renderWith('running', true);
    expect(button('Stop')).toBeDisabled();
  });

  it('stopping: still Stop, busy, until the backend confirms', () => {
    renderWith('stopping');
    expect(button('Execute')).toBeNull();
    const stop = button('Stop')!;
    expect(stop).toBeDisabled();
    expect(stop).toHaveAttribute('data-loading');
  });

  it('stopped: Execute again', () => {
    renderWith('stopped');
    expect(button('Execute')).toBeEnabled();
    expect(button('Stop')).toBeNull();
  });
});
