import { useEffect, useState, type FormEvent } from "react";
import { fetchSettings, fetchTtsVoices, updateSettings } from "../api";
import type { AppSettings, StyleConfig, TtsVoiceOption } from "../types";

const STYLE_TITLE: Record<StyleConfig["styleId"], string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Edukasi Problem-Solution"
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

  const onStyleChange = <K extends keyof StyleConfig>(
    styleId: StyleConfig["styleId"],
    key: K,
    value: StyleConfig[K]
  ) => {
    if (!settings) {
      return;
    }
    const styles = settings.styles.map((style) =>
      style.styleId === styleId ? { ...style, [key]: value } : style
    );
    setSettings({ ...settings, styles });
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
    <section className="card">
      <h2>Settings</h2>
      <form className="grid-form" onSubmit={onSave}>
        <label>
          Script Model
          <input
            value={settings.scriptModel}
            onChange={(event) =>
              setSettings({ ...settings, scriptModel: event.target.value })
            }
          />
        </label>
        <label>
          TTS Model
          <input
            value={settings.ttsModel}
            onChange={(event) => setSettings({ ...settings, ttsModel: event.target.value })}
          />
        </label>
        <label>
          Max Video Seconds
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
        <div className="style-grid">
          {settings.styles.map((style) => (
            <article className="style-card" key={style.styleId}>
              <h3>{STYLE_TITLE[style.styleId]}</h3>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={style.enabled}
                  onChange={(event) =>
                    onStyleChange(style.styleId, "enabled", event.target.checked)
                  }
                />
                Aktif
              </label>
              <label>
                Voice Name
                <select
                  value={style.voiceName}
                  disabled={!voiceOptions.length}
                  onChange={(event) =>
                    onStyleChange(style.styleId, "voiceName", event.target.value)
                  }
                >
                  {!voiceOptions.some((voice) => voice.voiceName === style.voiceName) && (
                    <option value={style.voiceName}>
                      {style.voiceName} (tidak ada di katalog)
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
              <label>
                Speech Rate
                <input
                  type="number"
                  step="0.05"
                  min={0.7}
                  max={1.3}
                  value={style.speechRate}
                  onChange={(event) =>
                    onStyleChange(style.styleId, "speechRate", Number(event.target.value))
                  }
                />
              </label>
              <label>
                Prompt Template
                <textarea
                  rows={6}
                  value={style.promptTemplate}
                  onChange={(event) =>
                    onStyleChange(style.styleId, "promptTemplate", event.target.value)
                  }
                />
              </label>
            </article>
          ))}
        </div>
        <button type="submit" disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Settings"}
        </button>
      </form>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="err-text">{error}</p>}
    </section>
  );
}
