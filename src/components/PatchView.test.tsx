import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PatchView from './PatchView'

const PATCH = `fix stuff

diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old a
+new a
diff --git a/b.txt b/b.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/b.txt
@@ -0,0 +1 @@
+hello b
`

describe('PatchView', () => {
  it('lists the files and shows the one clicked', () => {
    render(<PatchView repo="/r" patch={PATCH} header={null} />)
    expect(screen.getByText('2 changed files')).toBeTruthy()
    expect(screen.getByText('new a')).toBeTruthy()
    expect(screen.queryByText('hello b')).toBeNull()

    fireEvent.click(screen.getByText('b.txt'))
    expect(screen.getByText('hello b')).toBeTruthy()
    expect(screen.queryByText('new a')).toBeNull()
  })

  it('copies paths from the right-click menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<PatchView repo="/home/me/r" patch={PATCH} header={null} />)

    fireEvent.contextMenu(screen.getAllByText('a.ts')[0])
    fireEvent.click(screen.getByText('Copy relative path'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('src/a.ts'))
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.contextMenu(screen.getAllByText('a.ts')[0])
    fireEvent.click(screen.getByText('Copy full path'))
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith('/home/me/r/src/a.ts'),
    )
  })
})
