import type { ReactElement } from 'react';
import { MantineProvider } from '@mantine/core';
import { render } from '@testing-library/react';
import { theme, cssVariablesResolver } from '../theme';

/** render() inside the app's MantineProvider (env="test": no transitions or portals). */
export function renderWithMantine(ui: ReactElement) {
  return render(
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} env="test">
      {ui}
    </MantineProvider>,
  );
}
