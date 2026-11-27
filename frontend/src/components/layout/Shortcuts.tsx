import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useHotkeys } from '@/hooks';

interface ShortcutsApi {
  open: () => void;
}
const Ctx = createContext<ShortcutsApi>({ open: () => undefined });

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Approver view (claim detail)',
    items: [
      ['J', 'Next line (switches the receipt)'],
      ['K', 'Previous line'],
      ['A', 'Approve'],
      ['S', 'Send back with a comment'],
      ['R', 'Reject with a reason'],
      ['N', 'Next claim in your inbox'],
    ],
  },
  { title: 'Inbox', items: [['Enter', 'Open the oldest claim']] },
  { title: 'Anywhere', items: [['?', 'Show this help'], ['Esc', 'Close a dialog']] },
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-slate-200 border-b-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-700 shadow-xs">
      {children}
    </kbd>
  );
}

/** Global `?` shortcut help, available on every authenticated screen. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  useHotkeys({ '?': open });
  const api = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <Modal open={isOpen} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="md" testId="shortcuts-dialog">
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{g.title}</h3>
              <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {g.items.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <dt className="text-slate-700">{v}</dt>
                    <dd>
                      <Kbd>{k}</Kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="text-xs text-slate-500">Shortcuts are ignored while you type in a field.</p>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}

export function useShortcuts(): ShortcutsApi {
  return useContext(Ctx);
}
