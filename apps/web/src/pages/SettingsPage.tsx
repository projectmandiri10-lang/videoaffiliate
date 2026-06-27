import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchSettings, fetchTtsVoices, updateSettings } from "../api";
import type { AppSettings, PlatformSettings, TtsVoiceOption } from "../types";

function getYoutubePlatform(settings: AppSettings): PlatformSettings {
  return settings.platforms.find((platform) => platform.platformId === "youtube") ?? settings.platforms[0]!;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [loadedSettings, voiceData] = await Promise.all([
          fetchSettings(),
          fetchTtsVoices()
        ]);
        if (!mounted) {
          return;
        }
        setSettings(loadedSettings);
        setVoiceOptions(Array.isArray(voiceData.voices) ? voiceData.voices : []);
        setError("");
      } catch (loadError) {
        if (mounted) {
          setError((loadError as Error).message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  const youtubePlatform = useMemo(() => (settings ? getYoutubePlatform(settings) : null), [settings]);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || !youtubePlatform) {
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await updateSettings(settings);
      setSettings(saved);
      setMessage("Settings berhasil disimpan.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateYoutubePlatform = (patch: Partial<PlatformSettings>) => {
    if (!settings || !youtubePlatform) {
      return;
    }
    setSettings({
      ...settings,
      platforms: settings.platforms.map((platform) =>
        platform.platformId === "youtube" ? { ...platform, ...patch } : platform
      )
    });
  };

  if (loading || !settings || !youtubePlatform) {
    return (
      <section className="card">
        <h2>Settings</h2>
        <p>Memuat settings...</p>
        {error && <p className="err-text">{error}</p>}
      </section>
    );
  }

  return (
    <section className="page-shell settings-page">
      <header className="settings-hero glass-panel">
        <div>
          <div className="page-kicker">
            <i className="ti ti-settings-spark" />
            <span>Settings</span>
          </div>
          <p className="eyebrow">YouTube Shorts Core</p>
          <h2>Kontrol model analisis dan voice over Gemini via LiteLLM</h2>
          <p className="page-intro">
            Settings disimpan lokal per browser. Workflow ini dikunci untuk YouTube Shorts affiliate maksimal 30 detik dengan analisis 6 frame dan voice over yang lebih hook-first.
          </p>
        </div>
        <button type="submit" form="settings-form" className="primary-button" disabled={saving}>
          <i className="ti ti-device-floppy" aria-hidden="true" />
          <span>{saving ? "Menyimpan..." : "Simpan Settings"}</span>
        </button>
      </header>

      <form id="settings-form" className="grid-form settings-form" onSubmit={onSave}>
        <section className="settings-core glass-panel">
          <div className="section-title">
            <i className="ti ti-binary" />
            <h3>Model & Batasan</h3>
          </div>

          <div className="settings-core__grid">
            <label className="form-field">
              <span className="field-kicker">Script Model</span>
              <input
                value={settings.scriptModel}
                onChange={(event) =>
                  setSettings({ ...settings, scriptModel: event.target.value })
                }
              />
              <span className="small">Isi model alias LiteLLM atau model Gemini langsung, misalnya `gemini-2.5-pro`.</span>
            </label>

            <label className="form-field">
              <span className="field-kicker">TTS Model</span>
              <input
                value={settings.ttsModel}
                onChange={(event) => setSettings({ ...settings, ttsModel: event.target.value })}
              />
              <span className="small">
                Default voice over via LiteLLM: `gemini-2.5-flash-preview-tts`.
              </span>
            </label>

            <label className="form-field">
              <span className="field-kicker">Max Video Seconds</span>
              <input
                type="number"
                min={18}
                max={30}
                value={settings.maxVideoSeconds}
                onChange={(event) =>
                  setSettings({ ...settings, maxVideoSeconds: Number(event.target.value) })
                }
              />
              <span className="small">Disarankan tetap `30 detik` agar render browser dan hook Shorts lebih optimal.</span>
            </label>
          </div>
        </section>

        <section className="settings-core glass-panel">
          <div className="section-title">
            <i className="ti ti-microphone-2" />
            <h3>Voice YouTube Shorts</h3>
          </div>

          <div className="settings-core__grid">
            <label className="form-field">
              <span className="field-kicker">Voice Name</span>
              <select
                value={youtubePlatform.voiceName}
                disabled={!voiceOptions.length}
                onChange={(event) => updateYoutubePlatform({ voiceName: event.target.value })}
              >
                {voiceOptions.map((voice) => (
                  <option key={voice.voiceName} value={voice.voiceName}>
                    {voice.label} - {voice.tone} ({voice.gender})
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span className="field-kicker">Speech Rate</span>
              <input
                type="number"
                step="0.05"
                min={0.7}
                max={1.3}
                value={youtubePlatform.speechRate}
                onChange={(event) =>
                  updateYoutubePlatform({ speechRate: Number(event.target.value) })
                }
              />
            </label>
          </div>
        </section>
      </form>

      {message && <p className="ok-text">{message}</p>}
      {error && <p className="err-text">{error}</p>}
    </section>
  );
}
