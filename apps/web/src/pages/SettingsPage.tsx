import { useEffect, useState, type FormEvent } from "react";
import { fetchSettings, fetchTtsVoices, updateSettings } from "../api";
import type { AppSettings, PlatformSettings, TtsVoiceOption } from "../types";

const PLATFORM_TITLE: Record<PlatformSettings["platformId"], string> = {
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
  facebook: "Facebook",
  shopee: "Shopee"
};

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [voiceCatalogError, setVoiceCatalogError] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const loadedSettings = await fetchSettings();
        if (!mounted) {
          return;
        }
        setSettings(loadedSettings);
        setError("");
      } catch (loadError) {
        if (mounted) {
          setError((loadError as Error).message);
          setLoading(false);
        }
        return;
      }

      try {
        const voiceData = await fetchTtsVoices();
        if (!mounted) {
          return;
        }
        setVoiceOptions(Array.isArray(voiceData.voices) ? voiceData.voices : []);
        setVoiceCatalogError("");
      } catch (loadError) {
        if (mounted) {
          setVoiceCatalogError((loadError as Error).message);
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

  const onPlatformChange = <K extends keyof PlatformSettings>(
    platformId: PlatformSettings["platformId"],
    key: K,
    value: PlatformSettings[K]
  ) => {
    if (!settings) {
      return;
    }
    const platforms = settings.platforms.map((platform) =>
      platform.platformId === platformId ? { ...platform, [key]: value } : platform
    );
    setSettings({ ...settings, platforms });
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) {
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

  if (loading || !settings) {
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
          <p className="eyebrow">Configuration Matrix</p>
          <h2>Settings</h2>
          <p className="page-intro">
            Tone, hook, dan subtitle style dikunci oleh sistem. Isi `Script Model` dan `TTS
            Model` sesuai provider masing-masing: script/caption lewat SnifoxAI, voice-over lewat
            Gemini TTS direct.
          </p>
          <p className="section-note">
            Jika model utama di SnifoxAI gagal, server akan fallback otomatis ke model text-only
            yang tersedia. Jika Gemini TTS ditolak, server hanya akan fallback ke voice Windows
            lokal bila ada voice Indonesia; kalau tidak ada, job akan gagal dengan pesan yang
            jelas.
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
            <h3>System Core</h3>
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
              <span className="small">Contoh SnifoxAI: google/gemini-3-flash-preview.</span>
            </label>

            <label className="form-field">
              <span className="field-kicker">TTS Model</span>
              <input
                value={settings.ttsModel}
                onChange={(event) => setSettings({ ...settings, ttsModel: event.target.value })}
              />
              <span className="small">
                Dipakai oleh Gemini direct TTS, contoh: gemini-2.5-flash-preview-tts.
              </span>
            </label>

            <label className="form-field">
              <span className="field-kicker">Max Video Seconds</span>
              <input
                type="number"
                min={10}
                max={180}
                value={settings.maxVideoSeconds}
                onChange={(event) =>
                  setSettings({ ...settings, maxVideoSeconds: Number(event.target.value) })
                }
              />
            </label>

            <label className="form-field">
              <span className="field-kicker">CTA Mode</span>
              <select
                value={settings.ctaMode}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    ctaMode: event.target.value as AppSettings["ctaMode"]
                  })
                }
              >
                <option value="random">Random</option>
                <option value="sequential">Berurutan</option>
              </select>
            </label>
          </div>
        </section>

        <section className="settings-platforms">
          <div className="section-title section-title--spaced">
            <i className="ti ti-share" />
            <h3>Platform Hub</h3>
          </div>

          <div className="style-grid">
            {settings.platforms.map((platform) => (
              <article
                className={`platform-settings-card glass-panel ${
                  platform.enabled ? "is-enabled" : "is-disabled"
                }`}
                key={platform.platformId}
              >
                <div className="platform-settings-card__head">
                  <div>
                    <h3>{PLATFORM_TITLE[platform.platformId]}</h3>
                    <span className={platform.enabled ? "status status-success" : "status status-queued"}>
                      {platform.enabled ? "active" : "disabled"}
                    </span>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={platform.enabled}
                      onChange={(event) =>
                        onPlatformChange(platform.platformId, "enabled", event.target.checked)
                      }
                    />
                    Aktif
                  </label>
                </div>

                <label className="form-field">
                  <span className="field-kicker">Voice Name</span>
                  <select
                    value={platform.voiceName}
                    disabled={!voiceOptions.length}
                    onChange={(event) =>
                      onPlatformChange(platform.platformId, "voiceName", event.target.value)
                    }
                  >
                    {!voiceOptions.some((voice) => voice.voiceName === platform.voiceName) && (
                      <option value={platform.voiceName}>
                        {platform.voiceName} (tidak ada di katalog)
                      </option>
                    )}
                    {voiceOptions.map((voice) => (
                      <option key={voice.voiceName} value={voice.voiceName}>
                        {voice.label} - {voice.tone} ({voice.gender})
                      </option>
                    ))}
                  </select>
                  {voiceCatalogError && (
                    <span className="small err-inline">
                      Gagal memuat katalog voice: {voiceCatalogError}
                    </span>
                  )}
                </label>

                <label className="form-field">
                  <span className="field-kicker">Speech Rate</span>
                  <input
                    type="number"
                    step="0.05"
                    min={0.7}
                    max={1.3}
                    value={platform.speechRate}
                    onChange={(event) =>
                      onPlatformChange(
                        platform.platformId,
                        "speechRate",
                        Number(event.target.value)
                      )
                    }
                  />
                </label>
              </article>
            ))}
          </div>
        </section>
      </form>

      {message && <p className="ok-text">{message}</p>}
      {error && <p className="err-text">{error}</p>}
    </section>
  );
}
