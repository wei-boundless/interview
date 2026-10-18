import { REVEAL_HOLD_DELAYS } from '../../shared/holdRevealGate';
import { useEffect, useState } from 'react';
import { DEFAULT_REVEAL_SHORTCUT } from '../../shared/revealShortcut';
import type {
  AnswerLang,
  AsrLanguage,
  FontScale,
  ProviderSlot,
  ProviderTestResult,
  ProviderVerification,
  PublicSettings,
  ThemeMode,
  UiLang,
} from '../../shared/protocol';
import {
  LOCAL_REALTIME_MODELS,
  PROVIDER_HELP,
  findPresetById,
  findPresetByEndpoint,
  presetsForCapability,
  providerIdForEndpoint,
  type ProviderCapability,
  type ProviderPreset,
} from '../../shared/providerCatalog';
import {
  candidateKeyTest,
  isTestableTarget,
  storedKeyTest,
  type EndpointTarget,
} from '../../shared/providerTestRequests';
import { sanitizeApiKeyInput } from '../../shared/keyInput';
import { listMics } from '../audio/micCapture';
import { useT } from '../i18n';
import { ConnectionResult } from './providers/ConnectionResult';
import { connectionResultCopy } from './providers/copy';

type AsrBackend = 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';

/**
 * One API-key slot in the panel. Keys are write-only: the renderer never sees
 * a stored key, only whether one exists plus its last-4 hint. Three outcomes
 * feed the save patch — leave alone (undefined), replace (the new plaintext),
 * delete (`''`, which SettingsStore.applyPatch treats as "clear this slot").
 */
function useKeySlot() {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const reset = (): void => {
    setValue('');
    setEditing(false);
    setPendingDelete(false);
    setConfirming(false);
  };

  /** the `apiKey` field for the settings patch, or undefined to keep it */
  const patchValue = (): string | undefined => {
    if (pendingDelete) return '';
    const clean = sanitizeApiKeyInput(value).value;
    return clean || undefined;
  };

  return {
    value,
    setValue,
    editing,
    setEditing,
    pendingDelete,
    setPendingDelete,
    confirming,
    setConfirming,
    reset,
    patchValue,
  };
}

type KeySlot = ReturnType<typeof useKeySlot>;

/** in-flight / finished connection test for one provider slot */
interface SlotTest {
  testing: boolean;
  result?: ProviderTestResult;
  at?: number;
  /** the IPC itself failed (provider failures arrive as a result, not a throw) */
  error?: string;
  /** the verdict belongs to a key that is typed but not saved yet */
  candidate?: boolean;
}

/** the public (secret-free) view of one credential slot */
function publicSlot(
  s: PublicSettings,
  slot: ProviderSlot,
): { apiKeySet: boolean; apiKeyHint?: string; verification?: ProviderVerification } {
  switch (slot) {
    case 'llm':
      return s.llm;
    case 'vision':
      return s.vision;
    case 'asr-cloud':
      return s.asr.cloud;
    case 'asr-realtime':
    default:
      return s.asr.realtime;
  }
}

/**
 * BYOK settings (R7). Reorganised in Phase 2 into 常用 / 高级 (SPEC §G) and
 * fed by shared/providerCatalog.ts instead of the local preset constants that
 * used to live here — the wizard and this panel now offer exactly the same
 * providers, selected by stable preset id rather than by URL matching.
 * baseUrl/model keep being stored in settings for compatibility; providerId is
 * derived from them at save time.
 */
export function SettingsPanel({
  settings,
  onSaved,
  onClose,
  onRerunWizard,
  onOpenDiagnostics,
  onOpenHelp,
}: {
  settings: PublicSettings;
  onSaved: (s: PublicSettings) => void;
  onClose: () => void;
  /** opens the first-run wizard again (main window stays alive) */
  onRerunWizard?: () => void;
  /** 高级 entry into the local support report */
  onOpenDiagnostics?: () => void;
  /** in-app help center (also reachable from the tray) */
  onOpenHelp?: () => void;
}) {
  const t = useT();
  const [baseUrl, setBaseUrl] = useState(settings.llm.baseUrl);
  const [model, setModel] = useState(settings.llm.model);
  const [answerLang, setAnswerLang] = useState<AnswerLang>(settings.llm.answerLang);
  const [language, setLanguage] = useState<AsrLanguage>(settings.asr.language);
  const [hotkey, setHotkey] = useState(settings.ui.hotkeyToggle);
  const [visionBaseUrl, setVisionBaseUrl] = useState(settings.vision.baseUrl ?? '');
  const [visionModel, setVisionModel] = useState(settings.vision.model ?? '');
  const [visionProxy, setVisionProxy] = useState(settings.vision.proxyUrl ?? '');
  const [asrBackend, setAsrBackend] = useState<AsrBackend>(settings.asr.backend);
  const [cloudBaseUrl, setCloudBaseUrl] = useState(settings.asr.cloud.baseUrl ?? '');
  const [cloudModel, setCloudModel] = useState(settings.asr.cloud.model ?? '');
  const [rtBaseUrl, setRtBaseUrl] = useState(settings.asr.realtime.baseUrl ?? '');
  const [rtModel, setRtModel] = useState(settings.asr.realtime.model ?? '');
  const [rtLocalModel, setRtLocalModel] = useState(
    settings.asr.localRealtime.model ?? 'fun-asr-nano',
  );
  const [hotkeyShot, setHotkeyShot] = useState(settings.ui.hotkeyShot);
  const [hotkeyFullShot, setHotkeyFullShot] = useState(settings.ui.hotkeyFullShot);
  const [hotkeyVisionBatch, setHotkeyVisionBatch] = useState(settings.ui.hotkeyVisionBatch);
  const [hotkeyVisionPrev, setHotkeyVisionPrev] = useState(settings.ui.hotkeyVisionPrev);
  const [hotkeyVisionNext, setHotkeyVisionNext] = useState(settings.ui.hotkeyVisionNext);
  const [hotkeyVisionClear, setHotkeyVisionClear] = useState(settings.ui.hotkeyVisionClear);
  const [hotkeyAnswerScrollUp, setHotkeyAnswerScrollUp] = useState(settings.ui.hotkeyAnswerScrollUp);
  const [hotkeyAnswerScrollDown, setHotkeyAnswerScrollDown] = useState(settings.ui.hotkeyAnswerScrollDown);
  const [displayHotkeys, setDisplayHotkeys] = useState({
    hotkeyRevealHold: settings.ui.hotkeyRevealHold ?? DEFAULT_REVEAL_SHORTCUT,
    hotkeyTextOnly: settings.ui.hotkeyTextOnly ?? '',
    hotkeyFade: settings.ui.hotkeyFade ?? '',
    hotkeyTranscript: settings.ui.hotkeyTranscript ?? '',
  });
  const [autoLaunch, setAutoLaunch] = useState(settings.ui.autoLaunch);
  const [fontScale, setFontScale] = useState<FontScale>(settings.ui.fontScale ?? 'medium');
  const [opacity, setOpacity] = useState(settings.ui.opacity ?? 0.94);
  const [textOnly, setTextOnly] = useState(!!settings.ui.textOnly);
  const [outputAutoSize, setOutputAutoSize] = useState(!!settings.ui.outputAutoSize);
  const [fadeEnabled, setFadeEnabled] = useState(!!settings.ui.fadeEnabled);
  const [revealHoldDelayMs, setRevealHoldDelayMs] = useState(settings.ui.revealHoldDelayMs ?? 0);
  const [textOpacity, setTextOpacity] = useState(settings.ui.textOpacity ?? 0.35);
  const [hideInput, setHideInput] = useState(!!settings.ui.hideInput);
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => { void window.mc.getAppInfo().then((info) => setAppVersion(info.version)).catch(() => setAppVersion('')); }, []);
  const [appearanceError, setAppearanceError] = useState('');
  const [theme, setTheme] = useState<ThemeMode>(settings.ui.theme ?? 'dark');
  const [uiLang, setUiLang] = useState<UiLang>(settings.ui.lang);
  const [themDeviceId, setThemDeviceId] = useState(settings.audio.themDeviceId ?? '');
  const [micDeviceId, setMicDeviceId] = useState(settings.audio.micDeviceId ?? '');
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  /** weak-crypto confirmation is pending; nothing has been sent to main yet */
  const [confirmWeak, setConfirmWeak] = useState(false);

  const llmKey = useKeySlot();
  const visionKey = useKeySlot();
  const cloudKey = useKeySlot();
  const rtKey = useKeySlot();

  /**
   * Live secret-free snapshot. The props seed the form once (uncontrolled by
   * design: the panel is a draft the user commits with 保存), but 已配置 flags
   * and connection-test verdicts must reflect what the main process just
   * recorded — a test writes `verification` through a dedicated store write.
   */
  const [live, setLive] = useState<PublicSettings>(settings);
  const [tests, setTests] = useState<Partial<Record<ProviderSlot, SlotTest>>>({});
  const anyTesting = Object.values(tests).some((s) => s?.testing);
  const resultCopy = connectionResultCopy(t);

  useEffect(() => {
    void listMics()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  /**
   * One real provider round-trip on an explicit click. A key typed above wins
   * over the stored one — that is the 更换 Key flow's whole question — and the
   * candidate is NOT saved by the test: 保存 still commits the form.
   */
  const runSlotTest = async (slot: ProviderSlot, target: EndpointTarget, candidate: string) => {
    setTests((s) => ({ ...s, [slot]: { testing: true, candidate: candidate !== '' } }));
    try {
      const result = await window.mc.providerTest(
        candidate ? candidateKeyTest(target, candidate) : storedKeyTest(target),
      );
      setTests((s) => ({
        ...s,
        [slot]: { testing: false, result, at: Date.now(), candidate: candidate !== '' },
      }));
    } catch (e) {
      setTests((s) => ({
        ...s,
        [slot]: { testing: false, error: t.settings.testCrashed((e as Error).message) },
      }));
    }
    try {
      // main recorded the verdict into the slot — re-read so 上次测试… is current
      setLive(await window.mc.getSettings());
    } catch {
      /* the verdict is already on screen; a stale snapshot is not worth failing */
    }
  };

  /** the provider's own key page, for the failure path */
  const keyPageFor = (target: EndpointTarget): string | undefined =>
    findPresetByEndpoint(target.baseUrl, target.model, target.capability)?.help.keyUrl ??
    PROVIDER_HELP[target.providerId].keyUrl;

  const verificationSummary = (v: ProviderVerification | undefined): string => {
    if (!v?.lastTestAt) return t.settings.testNever;
    const when = new Date(v.lastTestAt).toLocaleString(t.locale);
    return v.lastTestOk ? t.settings.testLastOk(when, v.latencyMs) : t.settings.testLastFail(when);
  };

  /** preset display name in the current UI language */
  const presetName = (p: ProviderPreset): string => (t.uiLang === 'zh' ? p.nameZh : p.nameEn);

  /** a save that would persist at least one NEW plaintext key (a deletion is
   * `''`, which never writes a secret and therefore needs no warning) */
  const savesAKey = (): boolean =>
    [llmKey, visionKey, cloudKey, rtKey].some((s) => {
      const v = s.patchValue();
      return v !== undefined && v !== '';
    });

  /** pre-flight: ask before the plaintext leaves the renderer, so 「返回」
   * really means the key was never persisted */
  const requestSave = () => {
    if (settings.weakCrypto && savesAKey()) {
      setConfirmWeak(true);
      return;
    }
    void save();
  };

  const save = async () => {
    setConfirmWeak(false);
    setSaving(true);
    try {
      const llmApiKey = llmKey.patchValue();
      const visionApiKey = visionKey.patchValue();
      const cloudApiKey = cloudKey.patchValue();
      const rtApiKey = rtKey.patchValue();
      const next = await window.mc.setSettings({
        llm: {
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          answerLang,
          providerId: providerIdForEndpoint(baseUrl.trim(), model.trim(), 'text-llm'),
          ...(llmApiKey !== undefined ? { apiKey: llmApiKey } : {}),
        },
        vision: {
          baseUrl: visionBaseUrl.trim(),
          model: visionModel.trim(),
          proxyUrl: visionProxy.trim(),
          providerId: providerIdForEndpoint(visionBaseUrl.trim(), visionModel.trim(), 'vision'),
          ...(visionApiKey !== undefined ? { apiKey: visionApiKey } : {}),
        },
        asr: {
          language,
          backend: asrBackend,
          // local backends have no cloud provider; leave the stored value alone
          ...(asrBackend === 'cloud-realtime'
            ? {
                providerId: providerIdForEndpoint(
                  rtBaseUrl.trim(),
                  rtModel.trim(),
                  'asr-realtime',
                ),
              }
            : asrBackend === 'cloud'
              ? {
                  providerId: providerIdForEndpoint(
                    cloudBaseUrl.trim(),
                    cloudModel.trim(),
                    'asr-segment',
                  ),
                }
              : {}),
          cloud: {
            baseUrl: cloudBaseUrl.trim(),
            model: cloudModel.trim(),
            ...(cloudApiKey !== undefined ? { apiKey: cloudApiKey } : {}),
          },
          realtime: {
            baseUrl: rtBaseUrl.trim(),
            model: rtModel.trim(),
            ...(rtApiKey !== undefined ? { apiKey: rtApiKey } : {}),
          },
          localRealtime: { model: rtLocalModel },
        },
        ui: {
          ...displayHotkeys,
          hotkeyToggle: hotkey.trim(),
          hotkeyShot: hotkeyShot.trim(),
          hotkeyFullShot: hotkeyFullShot.trim(),
          hotkeyVisionBatch: hotkeyVisionBatch.trim(),
          hotkeyVisionPrev: hotkeyVisionPrev.trim(),
          hotkeyVisionNext: hotkeyVisionNext.trim(),
          hotkeyVisionClear: hotkeyVisionClear.trim(),
          hotkeyAnswerScrollUp: hotkeyAnswerScrollUp.trim(),
          hotkeyAnswerScrollDown: hotkeyAnswerScrollDown.trim(),
          fontScale,
          opacity,
          textOnly,

          outputAutoSize,
          fadeEnabled,
          textOpacity,
          revealHoldDelayMs,
          hideInput,
          theme,
          lang: uiLang,
          autoLaunch,
        },
        audio: {
          themDeviceId: themDeviceId || undefined,
          micDeviceId: micDeviceId || undefined,
        },
      });
      llmKey.reset();
      visionKey.reset();
      cloudKey.reset();
      rtKey.reset();
      onSaved(next);
    } finally {
      setSaving(false);
    }
  };

  /** provider dropdown driven by the catalog; the value is always the truth
   * derived from the stored baseUrl+model, so an unmatched pair reads 自定义 */
  const providerSelect = (
    capability: ProviderCapability,
    currentBaseUrl: string,
    currentModel: string,
    onPick: (p: ProviderPreset) => void,
  ) => {
    const presets = presetsForCapability(capability).filter((p) => p.baseUrl && p.model);
    const current = findPresetByEndpoint(currentBaseUrl, currentModel, capability);
    return (
      <select
        value={current?.id ?? ''}
        onChange={(e) => {
          const p = findPresetById(e.target.value);
          if (p) onPick(p);
        }}
      >
        {!current && <option value="">{t.settings.providerCustom}</option>}
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {presetName(p)}
          </option>
        ))}
      </select>
    );
  };

  const keyRow = (label: string, slot: KeySlot, slotId: ProviderSlot, target: EndpointTarget) => {
    const pub = publicSlot(live, slotId);
    const apiKeySet = pub.apiKeySet;
    const hint = pub.apiKeyHint;
    const state = tests[slotId];
    const candidate = sanitizeApiKeyInput(slot.value).value;
    const canTest =
      isTestableTarget(target) && !slot.pendingDelete && (candidate !== '' || apiKeySet);
    const keyUrl = keyPageFor(target);
    return (
      <div className="settings-row">
        <label>{label}</label>
        {apiKeySet && !slot.editing && !slot.pendingDelete ? (
          <div className="key-status">
            <span className="tag tag-ok">{t.settings.keyConfigured}</span>
            {hint && <span className="key-mask">{`••••${hint}`}</span>}
            <button className="btn btn-sm" onClick={() => slot.setEditing(true)}>
              {t.settings.keyReplace}
            </button>
            {slot.confirming ? (
              <>
                <span className="settings-inline-hint">{t.settings.keyDeleteConfirm}</span>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    slot.setPendingDelete(true);
                    slot.setConfirming(false);
                  }}
                >
                  {t.settings.keyDeleteYes}
                </button>
                <button className="btn btn-sm" onClick={() => slot.setConfirming(false)}>
                  {t.settings.keyDeleteNo}
                </button>
              </>
            ) : (
              <button className="btn btn-sm" onClick={() => slot.setConfirming(true)}>
                {t.settings.keyDelete}
              </button>
            )}
          </div>
        ) : slot.pendingDelete ? (
          <div className="key-status">
            <span className="tag tag-err">{t.settings.keyPendingDelete}</span>
            <button className="btn btn-sm" onClick={slot.reset}>
              {t.settings.keyUndoDelete}
            </button>
          </div>
        ) : (
          <>
            <input
              type="password"
              value={slot.value}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => slot.setValue(e.target.value)}
              placeholder={apiKeySet ? t.settings.keyNewPlaceholder : 'sk-…'}
            />
            <span className="settings-inline-hint">
              {apiKeySet ? t.settings.keyKeepPlaceholder : t.settings.keyMissing} ·{' '}
              {t.settings.keySanitizedHint}
            </span>
          </>
        )}

        <div className="key-status">
          <button
            className="btn btn-sm"
            disabled={!canTest || anyTesting}
            title={canTest ? undefined : t.settings.testNoKey}
            onClick={() => void runSlotTest(slotId, target, candidate)}
          >
            {state?.testing ? t.settings.testing : t.settings.testConnection}
          </button>
          <span className="settings-inline-hint">{verificationSummary(pub.verification)}</span>
        </div>

        <ConnectionResult
          copy={resultCopy}
          result={state?.result ?? null}
          testing={state?.testing}
          message={
            state?.result
              ? t.uiLang === 'zh'
                ? state.result.messageZh
                : state.result.messageEn
              : undefined
          }
          hint={state?.result ? t.settings.testHints[state.result.code] : undefined}
          at={state?.at}
        >
          {keyUrl && (
            <button className="btn btn-sm" onClick={() => void window.mc.openExternal(keyUrl)}>
              {t.settings.testOpenKeyPage}
            </button>
          )}
        </ConnectionResult>
        {state?.result?.ok && state.candidate && (
          <span className="settings-inline-hint">{t.settings.testCandidateOk}</span>
        )}
        {state?.error && <div className="settings-warn">{state.error}</div>}
      </div>
    );
  };

  /** where each key row points its connection test */
  const llmTarget = (): EndpointTarget => ({
    capability: 'text-llm',
    providerId: providerIdForEndpoint(baseUrl.trim(), model.trim(), 'text-llm'),
    baseUrl,
    model,
    slot: 'llm',
  });
  const visionTarget = (): EndpointTarget => ({
    capability: 'vision',
    providerId: providerIdForEndpoint(visionBaseUrl.trim(), visionModel.trim(), 'vision'),
    baseUrl: visionBaseUrl,
    model: visionModel,
    slot: 'vision',
    ...(visionProxy.trim() ? { proxyUrl: visionProxy.trim() } : {}),
  });
  const cloudTarget = (): EndpointTarget => ({
    capability: 'asr-segment',
    providerId: providerIdForEndpoint(cloudBaseUrl.trim(), cloudModel.trim(), 'asr-segment'),
    baseUrl: cloudBaseUrl,
    model: cloudModel,
    slot: 'asr-cloud',
  });
  const rtTarget = (): EndpointTarget => ({
    capability: 'asr-realtime',
    providerId: providerIdForEndpoint(rtBaseUrl.trim(), rtModel.trim(), 'asr-realtime'),
    baseUrl: rtBaseUrl,
    model: rtModel,
    slot: 'asr-realtime',
  });

  const asrSummary = (): string => {
    if (asrBackend === 'local') return t.settings.asrLocalWhisper;
    if (asrBackend === 'local-realtime') {
      const m = LOCAL_REALTIME_MODELS.find((x) => x.value === rtLocalModel);
      return m ? (t.uiLang === 'zh' ? m.nameZh : m.nameEn) : rtLocalModel;
    }
    const p =
      asrBackend === 'cloud-realtime'
        ? findPresetByEndpoint(rtBaseUrl, rtModel, 'asr-realtime')
        : findPresetByEndpoint(cloudBaseUrl, cloudModel, 'asr-segment');
    return p ? presetName(p) : t.settings.providerCustom;
  };

  const llmSummary = (): string => {
    const p = findPresetByEndpoint(baseUrl, model, 'text-llm');
    return p ? presetName(p) : `${model || '—'}`;
  };

  const deviceOptions = (
    <>
      <option value="">{t.settings.deviceDefault}</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || d.deviceId}
        </option>
      ))}
    </>
  );

  return (
    <div className="settings">
      <section className="display-settings" aria-labelledby="display-settings-title">
        <div className="settings-section" id="display-settings-title">{t.uiLang === 'zh' ? '外观与显示' : 'Appearance & display'} <span className="settings-version">{appVersion ? `v${appVersion}` : ''}</span></div>
      <div className="settings-row">
        <label>{t.settings.theme}</label>
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
          <option value="dark">{t.settings.themeDark}</option>
          <option value="light">{t.settings.themeLight}</option>
          <option value="system">{t.settings.themeSystem}</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.fontScaleLabel}</label>
        <select value={fontScale} onChange={(e) => setFontScale(e.target.value as FontScale)}>
          <option value="tiny">{t.uiLang === 'zh' ? '极小（10px）' : 'Tiny (10px)'}</option>
          <option value="extra-small">{t.uiLang === 'zh' ? '较小（11px）' : 'Extra small (11px)'}</option>
          <option value="small">{t.settings.fontSmall}</option>
          <option value="medium">{t.settings.fontMedium}</option>
          <option value="large">{t.settings.fontLarge}</option>
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="background-opacity">{t.uiLang === 'zh' ? '背景不透明度' : 'Background opacity'}</label>
        <input id="background-opacity" type="range" min="0.05" max="1" step="0.01" value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))} />
        <output htmlFor="background-opacity">{Math.round(opacity * 100)}%</output>
      </div>
      <div className="settings-row">
        <label htmlFor="text-only">{t.uiLang === 'zh' ? '界面模式' : 'Interface mode'}</label>
        <select id="text-only" value={textOnly ? 'text' : 'standard'} onChange={(e) => setTextOnly(e.target.value === 'text')}>
          <option value="standard">{t.uiLang === 'zh' ? '标准界面' : 'Standard view'}</option>
          <option value="text">{t.uiLang === 'zh' ? '仅文字（工具栏自动收起）' : 'Text only (toolbar auto-hides)'}</option>
        </select>
      </div>
      {textOnly && <div className="settings-row">
        <label htmlFor="output-sizing">{t.uiLang === 'zh' ? '输出适配' : 'Output sizing'}</label>
        <select id="output-sizing" value={outputAutoSize ? 'content' : 'window'} onChange={(e) => setOutputAutoSize(e.target.value === 'content')}>
          <option value="window">{t.uiLang === 'zh' ? '文字随窗口：自动换行' : 'Reflow text within window'}</option>
          <option value="content">{t.uiLang === 'zh' ? '高度适配当前回答：完整显示' : 'Fit height to current answer'}</option>
        </select>
        <span className="settings-inline-hint">{t.uiLang === 'zh' ? '只显示当前最新回答，按它的实际高度展开，宽度和字号不变。历史记录仍保留，退出此模式可查看；单条回答超过屏幕高度时才滚动。' : 'Shows the latest answer and fits its height without changing width or font size. History is preserved and returns on exit. Scroll only when this answer exceeds the screen height.'}</span>
      </div>}
      <div className="settings-hint">{t.uiLang === 'zh'
        ? '仅文字模式隐藏背景并穿透鼠标；移入顶部可操作，点击“操作文字”可滚动、选字或调整窗口。仅显示最新回答，历史记录保留；可选择固定高度或按回答适配高度。'
        : 'Text-only hides backgrounds and passes clicks through. Hover at the top for controls; choose “Interact” to scroll, select or resize. Shows the latest answer with optional automatic height; history is preserved.'}</div>
      <div className="settings-row">
        <label htmlFor="fade-enabled">{t.uiLang === 'zh' ? '文字淡化' : 'Fade text'}</label>
        <input id="fade-enabled" type="checkbox" checked={fadeEnabled} onChange={(e) => setFadeEnabled(e.target.checked)} />
      </div>
      <div className="settings-row">
        <label htmlFor="text-opacity">{t.uiLang === 'zh' ? '淡化时文字不透明度' : 'Text opacity when faded'}</label>
        <input id="text-opacity" type="range" min="0.01" max="1" step="0.01" value={textOpacity}
          onChange={(e) => setTextOpacity(Number(e.target.value))} />
        <output htmlFor="text-opacity">{Math.round(textOpacity * 100)}%</output>
      </div>
      <div className="fade-preview" style={{ opacity: fadeEnabled ? textOpacity : 1 }}>
        {t.uiLang === 'zh' ? '淡化预览：这里显示转写与回答内容。' : 'Fade preview: transcript and answer content appears here.'}
      </div>
      <div className="settings-hint">{t.uiLang === 'zh'
        ? '淡化独立开关，不随界面模式改变；Windows 中可在编辑器等软件里按住 Shift + · / 反引号查看，松开立即恢复。淡化启用时组合键由系统注册，单独输入 · 不触发。'
        : 'Fading is independent of interface mode: on Windows hold Shift + backquote to reveal in any app, release to fade. While fading is enabled, the combination is registered globally; backquote alone remains available for typing.'}</div>
      <div className="settings-hint">{t.uiLang === 'zh' ? '保存后生效。背景和文字分别调节；仅文字模式不显示背景。' : 'Applied on save. Background and text opacity are independent; text-only mode has no background.'}</div>
      <div className="settings-row">
        <label htmlFor="hide-input">{t.uiLang === 'zh' ? '隐藏底部输入框' : 'Hide question input'}</label>
        <input id="hide-input" type="checkbox" checked={hideInput} onChange={(e) => setHideInput(e.target.checked)} />
      </div>
      <section className="display-shortcuts"><div className="settings-section">{t.uiLang === 'zh' ? '显示快捷键（全局 / 窗口内）' : 'Display shortcuts (global / local)'}</div>
      <div className="settings-row">
        <label htmlFor="hotkeyRevealHold">{t.uiLang === 'zh' ? '按住查看（Windows 全局）' : 'Hold to reveal (global on Windows)'}</label>
        <input id="hotkeyRevealHold" value={DEFAULT_REVEAL_SHORTCUT} readOnly />
        <span className="settings-inline-hint">{t.uiLang === 'zh' ? '固定 Shift + · / 反引号（Esc 下方）。按住变清晰，松开任意一键恢复淡化；单独输入不触发。' : 'Fixed Shift + backquote. Hold to reveal; release either key to fade. Typing backquote alone does not reveal.'}</span>
      </div>
      {window.mc.platform === 'win32' && <div className="settings-row">
        <label htmlFor="reveal-hold-delay">{t.uiLang === 'zh' ? '按住查看延迟' : 'Hold-to-reveal delay'}</label>
        <select id="reveal-hold-delay" value={revealHoldDelayMs} onChange={(event) => setRevealHoldDelayMs(Number(event.target.value))}>
          {REVEAL_HOLD_DELAYS.map((delay) => <option key={delay} value={delay}>{delay === 0 ? (t.uiLang === 'zh' ? '无延迟（默认）' : 'No added delay (default)') : delay + (t.uiLang === 'zh' ? ' 毫秒' : ' ms')}</option>)}
        </select>
        <span className="settings-inline-hint">{t.uiLang === 'zh' ? '只影响按下后的等待时间；松开任意一键立即恢复淡化。' : 'Only delays revealing; releasing either key always restores fading immediately.'}</span>
      </div>}
      {([
        ['hotkeyTextOnly', '仅文字模式快捷键', 'Text-only toggle hotkey', 'Control+Alt+T'],
        ['hotkeyFade', '文字淡化快捷键', 'Fade toggle hotkey', 'Control+Alt+F'],
        ['hotkeyTranscript', '左栏显示快捷键', 'Transcript toggle hotkey', 'Control+Alt+L'],
      ] as const).map(([key, zh, en, example]) => (
        <div className="settings-row" key={key}>
          <label htmlFor={key}>{t.uiLang === 'zh' ? zh : en}</label>
          <input id={key} value={displayHotkeys[key]} spellCheck={false}
            placeholder={`${t.uiLang === 'zh' ? '未设置，例如' : 'Not set, e.g.'} ${example}`}
            onChange={(event) => setDisplayHotkeys((previous) => ({ ...previous, [key]: event.target.value.trim() }))} />
        </div>
      ))}
      <div className="settings-hint">{t.uiLang === 'zh'
        ? '以上是全局切换快捷键，可在其他窗口中使用；留空关闭，避免与系统或其他快捷键重复。点击“仅应用显示设置”即可保存。切换界面模式不会改变淡化设置。'
        : 'Global toggles work from other windows. Leave blank to disable; avoid shortcuts already in use. Save with “Apply display settings only”. Changing view preserves the fade setting.'}</div>
      </section>
      <div className="settings-row">
        <button className="btn" disabled={saving} onClick={async () => {
          setSaving(true);
          setAppearanceError('');
          try {
            // UI-only patch: do not resend ASR configuration and restart capture engines.
            onSaved(await window.mc.setSettings({ ui: { fontScale, opacity, hideInput, theme, textOnly, outputAutoSize, fadeEnabled, textOpacity, revealHoldDelayMs, ...displayHotkeys } }));
          } catch (error) {
            setAppearanceError((t.uiLang === 'zh' ? '未保存：请检查快捷键是否无效、重复或被占用。 ' : 'Not saved: check for invalid, duplicate or occupied shortcuts. ') + (error instanceof Error ? error.message : ''));
          } finally {
            setSaving(false);
          }
        }}>{t.uiLang === 'zh' ? '仅应用显示设置' : 'Apply display settings only'}</button>
        <span className="settings-inline-hint">{t.uiLang === 'zh' ? '仅保存本区设置，不影响录音与转写。' : 'Saves this section only; recording and transcription are unaffected.'}</span>
        {appearanceError && <div className="settings-warn" role="alert">{appearanceError}</div>}
      </div>
      </section>
      {/* ---------------- 常用 ---------------- */}
      <div className="settings-section">{t.settings.commonSection}</div>
      <div className="settings-hint">
        {t.settings.planSection}: {t.settings.planAsr} — {asrSummary()} · {t.settings.planLlm} —{' '}
        {llmSummary()}
      </div>
      {/* said once for the whole panel: every 测试连接 button below costs one
          minimal billable request, and tests only ever run on a click */}
      <div className="settings-hint">{t.settings.testFeeNote}</div>

      {window.mc.platform === 'darwin' && (
        <div className="settings-hint">{t.settings.macAudioHint}</div>
      )}
      <div className="settings-row">
        <label>{t.settings.asrBackend}</label>
        <select value={asrBackend} onChange={(e) => setAsrBackend(e.target.value as AsrBackend)}>
          <optgroup label={t.settings.asrLocalGroup}>
            <option value="local-realtime">{t.settings.asrLocalRealtime}</option>
            <option value="local">{t.settings.asrLocalWhisper}</option>
          </optgroup>
          <optgroup label={t.settings.asrCloudGroup}>
            <option value="cloud-realtime">{t.settings.asrCloudRealtime}</option>
            <option value="cloud">{t.settings.asrCloudSeg}</option>
          </optgroup>
        </select>
      </div>
      {asrBackend === 'local-realtime' && (
        <div className="settings-row">
          <label>{t.settings.localRtModel}</label>
          <select value={rtLocalModel} onChange={(e) => setRtLocalModel(e.target.value)}>
            {LOCAL_REALTIME_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {t.uiLang === 'zh' ? m.nameZh : m.nameEn}
              </option>
            ))}
          </select>
        </div>
      )}
      {asrBackend === 'cloud-realtime' && (
        <>
          <div className="settings-row">
            <label>{t.settings.providerPreset}</label>
            {providerSelect('asr-realtime', rtBaseUrl, rtModel, (p) => {
              setRtBaseUrl(p.baseUrl);
              setRtModel(p.model);
            })}
          </div>
          {keyRow(t.settings.rtApiKey, rtKey, 'asr-realtime', rtTarget())}
        </>
      )}
      {asrBackend === 'cloud' && (
        <>
          <div className="settings-row">
            <label>{t.settings.providerPreset}</label>
            {providerSelect('asr-segment', cloudBaseUrl, cloudModel, (p) => {
              setCloudBaseUrl(p.baseUrl);
              setCloudModel(p.model);
            })}
          </div>
          {keyRow(t.settings.cloudApiKey, cloudKey, 'asr-cloud', cloudTarget())}
        </>
      )}
      <div className="settings-row">
        <label>{t.settings.asrLanguage}</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value as AsrLanguage)}>
          <option value="auto">{t.settings.asrLangAuto}</option>
          <option value="chinese">{t.settings.asrLangZh}</option>
          <option value="english">{t.settings.asrLangEn}</option>
        </select>
      </div>

      <div className="settings-row">
        <label>
          {t.settings.planLlm} · {t.settings.providerPreset}
        </label>
        {providerSelect('text-llm', baseUrl, model, (p) => {
          setBaseUrl(p.baseUrl);
          setModel(p.model);
        })}
      </div>
      {keyRow(t.settings.apiKey, llmKey, 'llm', llmTarget())}
      <div className="settings-row">
        <label>{t.settings.answerLangLabel}</label>
        <select value={answerLang} onChange={(e) => setAnswerLang(e.target.value as AnswerLang)}>
          <option value="chinese">{t.settings.answerLangZh}</option>
          <option value="english">{t.settings.answerLangEn}</option>
        </select>
      </div>

      <div className="settings-row">
        <label>{t.settings.uiLang}</label>
        <select value={uiLang} onChange={(e) => setUiLang(e.target.value as UiLang)}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyToggle}</label>
        <input value={hotkey} onChange={(e) => setHotkey(e.target.value)} spellCheck={false} />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyShot}</label>
        <input
          value={hotkeyShot}
          onChange={(e) => setHotkeyShot(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyFullShot}</label>
        <input
          value={hotkeyFullShot}
          onChange={(e) => setHotkeyFullShot(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyVisionBatch}</label>
        <input
          value={hotkeyVisionBatch}
          onChange={(e) => setHotkeyVisionBatch(e.target.value)}
          spellCheck={false}
          placeholder={t.settings.hotkeyVisionBatchPlaceholder}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyVisionPrev}</label>
        <input
          value={hotkeyVisionPrev}
          onChange={(e) => setHotkeyVisionPrev(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyVisionNext}</label>
        <input
          value={hotkeyVisionNext}
          onChange={(e) => setHotkeyVisionNext(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyVisionClear}</label>
        <input
          value={hotkeyVisionClear}
          onChange={(e) => setHotkeyVisionClear(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyAnswerScrollUp}</label>
        <input
          value={hotkeyAnswerScrollUp}
          onChange={(e) => setHotkeyAnswerScrollUp(e.target.value)}
          spellCheck={false}
          placeholder={t.settings.hotkeyOptionalPlaceholder}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.hotkeyAnswerScrollDown}</label>
        <input
          value={hotkeyAnswerScrollDown}
          onChange={(e) => setHotkeyAnswerScrollDown(e.target.value)}
          spellCheck={false}
          placeholder={t.settings.hotkeyOptionalPlaceholder}
        />
      </div>
      <div className="settings-row">
        <label>{t.settings.autoLaunch}</label>
        <select
          value={autoLaunch ? 'on' : 'off'}
          onChange={(e) => setAutoLaunch(e.target.value === 'on')}
        >
          <option value="off">{t.settings.autoLaunchOff}</option>
          <option value="on">{t.settings.autoLaunchOn}</option>
        </select>
        <span className="settings-inline-hint">{t.settings.autoLaunchHint}</span>
      </div>

      <div className="settings-section">{t.settings.audioSection}</div>
      <div className="settings-row">
        <label>{t.settings.themDevice}</label>
        <select value={themDeviceId} onChange={(e) => setThemDeviceId(e.target.value)}>
          {deviceOptions}
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.micDevice}</label>
        <select value={micDeviceId} onChange={(e) => setMicDeviceId(e.target.value)}>
          {deviceOptions}
        </select>
      </div>
      <div className="settings-hint">{t.settings.otherHint}</div>

      {onOpenHelp && (
        <div className="settings-row">
          <button className="btn" onClick={onOpenHelp}>
            {t.help.title}
          </button>
          <span className="settings-inline-hint">{t.settings.helpHint}</span>
        </div>
      )}

      {onRerunWizard && (
        <div className="settings-row">
          <button className="btn" onClick={onRerunWizard}>
            {t.settings.rerunWizard}
          </button>
          <span className="settings-inline-hint">{t.settings.rerunWizardHint}</span>
        </div>
      )}

      {/* ---------------- 高级 ---------------- */}
      <details className="settings-advanced">
        <summary>{t.settings.advancedSection}</summary>
        <div className="settings-hint">{t.settings.advancedHint}</div>

        {onOpenDiagnostics && (
          <div className="settings-row">
            <button className="btn" onClick={onOpenDiagnostics}>
              {t.diagnostics.title}
            </button>
            <span className="settings-inline-hint">{t.diagnostics.intro}</span>
          </div>
        )}

        <div className="settings-section">{t.settings.textSection}</div>
        <div className="settings-row">
          <label>{t.settings.baseUrl}</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
        </div>
        <div className="settings-row">
          <label>{t.settings.model}</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        </div>

        <div className="settings-section">{t.settings.visionSection}</div>
        <div className="settings-hint">{t.settings.visionHint}</div>
        <div className="settings-row">
          <label>{t.settings.providerPreset}</label>
          {providerSelect('vision', visionBaseUrl, visionModel, (p) => {
            setVisionBaseUrl(p.baseUrl);
            setVisionModel(p.model);
            setVisionProxy(p.defaultProxyUrl ?? '');
          })}
        </div>
        <div className="settings-row">
          <label>{t.settings.visionBaseUrl}</label>
          <input
            value={visionBaseUrl}
            onChange={(e) => setVisionBaseUrl(e.target.value)}
            spellCheck={false}
            placeholder={t.settings.visionBaseUrlPlaceholder}
          />
        </div>
        <div className="settings-row">
          <label>{t.settings.visionModel}</label>
          <input
            value={visionModel}
            onChange={(e) => setVisionModel(e.target.value)}
            spellCheck={false}
          />
        </div>
        {keyRow(t.settings.visionApiKey, visionKey, 'vision', visionTarget())}
        <div className="settings-row">
          <label>{t.settings.visionProxy}</label>
          <input
            value={visionProxy}
            onChange={(e) => setVisionProxy(e.target.value)}
            spellCheck={false}
            placeholder={t.settings.visionProxyPlaceholder}
          />
        </div>

        <div className="settings-section">{t.settings.asrSection}</div>
        <div className="settings-row">
          <label>{t.settings.rtBaseUrl}</label>
          <input value={rtBaseUrl} onChange={(e) => setRtBaseUrl(e.target.value)} spellCheck={false} />
        </div>
        <div className="settings-row">
          <label>{t.settings.rtModel}</label>
          <input value={rtModel} onChange={(e) => setRtModel(e.target.value)} spellCheck={false} />
        </div>
        <div className="settings-row">
          <label>{t.settings.cloudBaseUrl}</label>
          <input
            value={cloudBaseUrl}
            onChange={(e) => setCloudBaseUrl(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="settings-row">
          <label>{t.settings.cloudModel}</label>
          <input
            value={cloudModel}
            onChange={(e) => setCloudModel(e.target.value)}
            spellCheck={false}
          />
        </div>
      </details>

      {confirmWeak && (
        <div className="settings-warn">
          <div>{t.settings.weakCryptoWarning}</div>
          <div className="settings-actions" style={{ marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => setConfirmWeak(false)}>
              {t.settings.weakCryptoBack}
            </button>
            <button className="btn btn-sm" onClick={() => void save()}>
              {t.settings.weakCryptoContinue}
            </button>
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={requestSave} disabled={saving}>
          {saving ? t.settings.saving : t.settings.save}
        </button>
        <button className="btn" onClick={onClose}>
          {t.settings.cancel}
        </button>
      </div>
    </div>
  );
}
