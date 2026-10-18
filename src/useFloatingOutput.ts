import { useEffect, useState } from 'react';

/** Temporary interaction is never persisted or used to change service state. */
export function useFloatingOutput(enabled: boolean, panelOpen: boolean, autoSize: boolean) {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => { setInteractive(false); }, [enabled]);
  useEffect(() => {
    let toolbarOpen = false;
    const update = () => window.mc.setOverlayInteraction(enabled &&
      (interactive || panelOpen || toolbarOpen || !!document.querySelector('.titlebar details[open]')), panelOpen);
    update();
    const bar = document.querySelector('.titlebar');
    const handle = bar?.querySelector('.text-only-trigger');
    const click = () => {
      if (!enabled) return;
      toolbarOpen = !toolbarOpen;
      bar?.classList.toggle('toolbar-revealed', toolbarOpen);
      handle?.setAttribute('aria-expanded', String(toolbarOpen));
      update();
    };
    const leave = () => {
      toolbarOpen = false;
      bar?.classList.remove('toolbar-revealed');
      handle?.setAttribute('aria-expanded', 'false');
      update();
    };
    handle?.addEventListener('click', click);
    bar?.addEventListener('mouseleave', leave);
    const observer = new MutationObserver(update);
    if (bar) observer.observe(bar, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => {
      observer.disconnect();
      bar?.classList.remove('toolbar-revealed');
      handle?.removeEventListener('click', click);
      bar?.removeEventListener('mouseleave', leave);
      window.mc.setOverlayInteraction(false);
    };
  }, [enabled, interactive, panelOpen]);
  useEffect(() => {
    if (!enabled || !autoSize) return;
    const root = document.querySelector('.app');
    const panes = document.querySelector('.panes');
    if (!root || !panes) return;
    let frame = 0;
    let lastSize = '';
    const measure = () => {
      frame = 0;
      const sizes = [...panes.querySelectorAll<HTMLElement>('.session, .transcript')]
        .filter((box) => box.offsetWidth > 0).map((box) => {
          let height = 8;
          for (const child of box.querySelectorAll<HTMLElement>(':scope > .turn, :scope > .bubble')) {
            const style = getComputedStyle(child);
            if (style.display === 'none') continue;
            height += child.getBoundingClientRect().height + parseFloat(style.marginBottom || '0');
          }
          return { height };
        });
      const stacked = getComputedStyle(panes).flexDirection === 'column';
      const height = stacked ? sizes.reduce((n, s) => n + s.height, 0) : Math.max(0, ...sizes.map((s) => s.height));
      const size = { height: Math.max(72, Math.ceil(height + 36)) };
      const key = `${size.height}`;
      if (key !== lastSize) { lastSize = key; window.mc.setOutputSize(size); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const mutation = new MutationObserver(schedule);
    mutation.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    schedule();
    return () => { mutation.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); };
  }, [enabled, autoSize]);
  return { interactive, setInteractive };
}
