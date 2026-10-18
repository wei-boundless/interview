import type { PublicSettings } from '../../shared/protocol';
import { useT } from '../i18n';

export function DisplayControls({ settings, busy, onToggle }: {
  settings: PublicSettings | null;
  busy: boolean;
  onToggle: (key: 'textOnly' | 'fadeEnabled' | 'hideTranscript') => void;
}) {
  const t = useT();
  const zh = t.uiLang === 'zh';
  const controls = [
    { key: 'textOnly', label: zh ? '仅文字' : 'Text only', title: zh ? '切换仅文字与标准界面' : 'Toggle text-only view' },
    { key: 'hideTranscript', label: zh ? '隐藏左栏' : 'Hide left', title: zh ? '显示或隐藏左侧转写' : 'Show or hide transcript' },
    { key: 'fadeEnabled', label: zh ? '文字淡化' : 'Fade text', title: zh ? '开启或关闭文字淡化' : 'Toggle text fading' },
  ] as const;
  return (
    <div className="display-toggles keep-visible" role="group" aria-label={zh ? '显示' : 'Display'}>
      {controls.map(({ key, label, title }) => (
        <button key={key} className="btn" type="button" disabled={!settings || busy}
          aria-pressed={!!settings?.ui[key]} title={title} onClick={() => onToggle(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}
