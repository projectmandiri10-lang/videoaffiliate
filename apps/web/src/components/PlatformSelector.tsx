import type { PlatformId } from "../types";
import { PLATFORM_LABEL, PLATFORM_ORDER } from "../platforms";

interface PlatformSelectorProps {
  selectedPlatformIds: PlatformId[];
  availablePlatformIds?: PlatformId[];
  disabled?: boolean;
  onTogglePlatform: (platformId: PlatformId) => void;
}

export function PlatformSelector({
  selectedPlatformIds,
  availablePlatformIds = PLATFORM_ORDER,
  disabled = false,
  onTogglePlatform
}: PlatformSelectorProps) {
  const selected = new Set(selectedPlatformIds);
  const available = new Set(availablePlatformIds);

  return (
    <div className="platform-selector">
      <div className="platform-selector__head">
        <span className="field-kicker">Platform Tujuan</span>
        <span className="small">{selectedPlatformIds.length} dipilih</span>
      </div>

      <div className="platform-selector__grid" role="group" aria-label="Platform tujuan">
        {PLATFORM_ORDER.map((platformId) => {
          const isAvailable = available.has(platformId);
          const isSelected = selected.has(platformId);

          return (
            <button
              key={platformId}
              type="button"
              className={`platform-toggle-chip ${isSelected ? "is-selected" : ""} ${
                !isAvailable ? "is-unavailable" : ""
              }`}
              aria-pressed={isSelected}
              onClick={() => onTogglePlatform(platformId)}
              disabled={disabled || !isAvailable}
            >
              <span className="platform-toggle-chip__label">{PLATFORM_LABEL[platformId]}</span>
              <span className="platform-toggle-chip__meta">
                {!isAvailable
                  ? "disabled di settings"
                  : isSelected
                    ? "voice over aktif"
                    : "skip render"}
              </span>
            </button>
          );
        })}
      </div>

      {availablePlatformIds.length === 0 && (
        <p className="err-inline">
          Aktifkan minimal satu platform di Settings agar job bisa dirender.
        </p>
      )}
    </div>
  );
}
